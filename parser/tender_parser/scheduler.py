import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from threading import Lock
from typing import Any

import structlog

from tender_parser.ai_suitability import (
    GroqSuitabilityClient,
    INFOSEC_RELEVANCE_TERMS,
    PHYSICAL_SECURITY_NEGATIVE_TERMS,
    SECURITY_SERVICE_REVIEW_TERMS,
    STRONG_SPEC_RELEVANCE_TERMS,
)
from tender_parser.config import Settings
from tender_parser.db import Database
from tender_parser.documents import DocumentService
from tender_parser.keywords import KeywordService
from tender_parser.logging_config import configure_logging
from tender_parser.notifications import NotificationService
from tender_parser.platforms import build_platforms
from tender_parser.platforms.base import TenderPlatform
from tender_parser.protocols import enrich_winner_from_text
from tender_parser.rag import RagClient
from tender_parser.schemas import TenderLot


class ParserScheduler:
    def __init__(self, settings: Settings, db: Database) -> None:
        configure_logging()
        self.log = structlog.get_logger("tender_parser")
        self.settings = settings
        self.db = db
        self.keywords = KeywordService(
            db,
            settings.default_keywords,
            settings.dictionaries_api_url,
            settings.request_timeout_seconds,
            settings.keywords_file_path,
            settings.stop_words_api_url,
            settings.default_stop_words,
            settings.backend_internal_service_token,
        )
        self.documents = DocumentService(settings.download_dir, settings.request_timeout_seconds)
        self.rag = RagClient(
            settings.rag_api_base,
            settings.request_timeout_seconds,
            settings.rag_extract_spec_points,
            settings.rag_include_extracted_text,
            settings.rag_internal_service_token,
        )
        self.ai_suitability = GroqSuitabilityClient(
            settings.gemini_api_key if settings.ai_provider.strip().lower() == "gemini" else settings.groq_api_key,
            settings.groq_api_base,
            settings.gemini_model if settings.ai_provider.strip().lower() == "gemini" else settings.groq_model,
            settings.request_timeout_seconds,
            settings.ai_lot_filter_min_score,
            settings.ai_company_profile,
            settings.ai_context_keywords,
            settings.ai_provider,
            settings.ai_require_spec_text,
            settings.ai_spec_text_max_chars,
            settings.ai_prompt_max_chars,
        )
        self.notifications = NotificationService(db, settings.our_bins, settings.telegram_bot_token, settings.telegram_chat_id, settings.request_timeout_seconds)
        self.platforms = build_platforms(settings)
        self._ai_lock = Lock()
        self._rag_lock = Lock()
        self._ai_cooldown_until = 0.0
        self._rag_cooldown_until = 0.0
        self._last_ai_request_at = 0.0
        self._last_rag_request_at = 0.0
        self._rag_spec_ai_requests_this_cycle = 0
        self._stop_words: list[str] = []

    def run_forever(self) -> None:
        self.log.info("parser_started", platforms=[p.name for p in self.platforms], interval=self.settings.poll_interval_seconds)
        while True:
            started = time.monotonic()
            try:
                self.run_once()
            except Exception as exc:
                self.log.exception("parser_cycle_failed", error=str(exc))
            elapsed = time.monotonic() - started
            sleep_for = max(5, self.settings.poll_interval_seconds - elapsed)
            self._sleep_or_run_requested(sleep_for)

    def _sleep_or_run_requested(self, sleep_for: float) -> None:
        deadline = time.monotonic() + sleep_for
        while time.monotonic() < deadline:
            request = self.db.claim_run_request()
            if request is not None:
                request_id = int(request["id"])
                mode = str(request.get("mode") or "parse")
                limit = int(request.get("limit") or 0)
                self.log.info("manual_parser_run_requested", request_id=request_id, run_mode=mode, limit=limit)
                try:
                    if mode == "reanalyze_existing":
                        self.reanalyze_existing_lots(limit=max(0, limit))
                        done_message = self.db.build_run_request_message(mode, limit, "VM parser AI reanalysis completed")
                    else:
                        self.run_once()
                        done_message = self.db.build_run_request_message("parse", 0, "VM parser run completed")
                    self.db.finish_run_request(request_id, "completed", done_message)
                    self.log.info("manual_parser_run_finished", request_id=request_id, run_mode=mode, limit=limit)
                except Exception as exc:
                    fail_message = self.db.build_run_request_message(mode, limit, f"VM parser request failed: {exc}")
                    self.db.finish_run_request(request_id, "failed", fail_message)
                    self.log.exception("manual_parser_run_failed", request_id=request_id, run_mode=mode, limit=limit, error=str(exc))
                deadline = time.monotonic() + self.settings.poll_interval_seconds
            time.sleep(min(5, max(0, deadline - time.monotonic())))

    def run_once(self) -> None:
        stop_words = self.keywords.load_stop_words()
        self._stop_words = stop_words
        keyword_rules = self.keywords.load_active_rules(stop_words)
        keywords = [rule.value for rule in keyword_rules]
        platform_names = [platform.name for platform in self.platforms]
        run_id = self.db.start_run(platform_names, keywords)
        self._rag_spec_ai_requests_this_cycle = 0
        lots_found = 0
        lots_changed = 0
        errors: list[dict[str, Any]] = []
        self.log.info(
            "parser_cycle_started",
            run_id=run_id,
            keywords_count=len(keywords),
            keyword_rules_count=len(keyword_rules),
            stop_words_count=len(stop_words),
            keywords=keywords,
            platforms=platform_names,
            collect_all_active_lots=self.settings.collect_all_active_lots,
        )
        if not keywords and not self.settings.collect_all_active_lots:
            self.db.finish_run(run_id, "no_keywords", lots_found, lots_changed, errors)
            self.log.warning("parser_cycle_no_keywords", run_id=run_id)
            return
        if not keywords:
            self.log.info("parser_cycle_without_keywords", run_id=run_id, reason="collect_all_active_lots_enabled")
        try:
            with ThreadPoolExecutor(max_workers=min(self.settings.max_workers, max(1, len(self.platforms)))) as pool:
                futures = {pool.submit(self._search_platform, platform, keywords): platform for platform in self.platforms}
                search_results: list[tuple[TenderPlatform, list[TenderLot]]] = []
                for future in as_completed(futures):
                    platform = futures[future]
                    try:
                        lots = future.result()
                        lots_found += len(lots)
                        search_results.append((platform, lots))
                    except Exception as exc:
                        errors.append({"platform": platform.name, "stage": "search", "error": str(exc)})
                        self.log.exception("platform_search_failed", platform=platform.name, error=str(exc))
            work: list[tuple[TenderPlatform, TenderLot]] = []
            remaining = self.settings.max_lots_per_cycle
            ai_context_keywords = self._ai_context_keywords(keywords)
            for platform, lots in search_results:
                limit = remaining if remaining > 0 else 0
                skipped_seen = 0
                if self.settings.process_existing_lots:
                    selected = lots[:limit] if limit > 0 else lots
                else:
                    selected, skipped_seen = self.db.filter_new_lots(lots, self.settings.stop_at_first_seen_lot, limit)
                for lot in selected:
                    lot.raw = {**lot.raw, "ai_context_keywords": ai_context_keywords}
                work.extend((platform, lot) for lot in selected)
                if remaining > 0:
                    remaining = max(0, remaining - len(selected))
                self.log.info(
                    "platform_work_selected",
                    platform=platform.name,
                    found=len(lots),
                    selected=len(selected),
                    skipped_seen=skipped_seen,
                    stop_at_first_seen=self.settings.stop_at_first_seen_lot,
                    process_existing=self.settings.process_existing_lots,
                )
                if remaining == 0 and self.settings.max_lots_per_cycle > 0:
                    break
            with ThreadPoolExecutor(max_workers=self.settings.max_workers) as pool:
                futures = {pool.submit(self._process_lot, platform, lot): lot for platform, lot in work}
                for future in as_completed(futures):
                    lot = futures[future]
                    try:
                        if future.result():
                            lots_changed += 1
                    except Exception as exc:
                        errors.append({"lot": lot.stable_id, "stage": "process", "error": str(exc)})
                        self.log.exception("lot_process_failed", lot=lot.stable_id, error=str(exc))
            self.db.finish_run(run_id, "ok" if not errors else "partial", lots_found, lots_changed, errors)
            self.log.info("parser_cycle_finished", run_id=run_id, lots_found=lots_found, lots_changed=lots_changed, errors=len(errors))
        except Exception:
            self.db.finish_run(run_id, "failed", lots_found, lots_changed, errors)
            raise

    def reanalyze_existing_lots(self, limit: int = 0) -> None:
        self._stop_words = self.keywords.load_stop_words()
        run_id = self.db.start_run(["ai_reanalyze_existing"], [])
        lots = self.db.load_existing_lots_for_ai(limit)
        changed = 0
        errors: list[dict[str, Any]] = []
        self.log.info("ai_reanalysis_started", run_id=run_id, lots=len(lots), limit=limit)
        try:
            for lot in lots:
                before = dict(lot.raw)
                try:
                    if self._reject_by_stop_word(lot):
                        if lot.raw != before:
                            self.db.update_lot_raw(lot)
                            changed += 1
                        self.log.info("ai_reanalysis_lot_stop_word", lot=lot.stable_id, stop_word=lot.raw.get("stop_word"))
                        continue
                    self._process_spec_documents(lot)
                    self._analyze_lot_with_ai(lot)
                    if lot.raw != before:
                        self.db.update_lot_raw(lot)
                        changed += 1
                    self.log.info("ai_reanalysis_lot_finished", lot=lot.stable_id, is_suitable=lot.raw.get("is_suitable"), ai_score=lot.raw.get("ai_score"))
                except Exception as exc:
                    errors.append({"lot": lot.stable_id, "stage": "ai_reanalysis", "error": str(exc)})
                    self.log.warning("ai_reanalysis_lot_failed", lot=lot.stable_id, error=str(exc))
            self.db.finish_run(run_id, "ok" if not errors else "partial", len(lots), changed, errors)
            self.log.info("ai_reanalysis_finished", run_id=run_id, lots=len(lots), changed=changed, errors=len(errors))
        except Exception:
            self.db.finish_run(run_id, "failed", len(lots), changed, errors)
            raise

    def _search_platform(self, platform: TenderPlatform, keywords: list[str]) -> list[TenderLot]:
        self.log.info("platform_search_started", platform=platform.name, strict_keyword_filter=self.settings.strict_keyword_filter, collect_all_active_lots=self.settings.collect_all_active_lots)
        lots = platform.search(keywords, self.db.lot_exists)
        lots, skipped_min_amount = self._apply_keyword_min_amount_filter(lots)
        matches_by_keyword: dict[str, int] = {}
        for lot in lots:
            keyword = self._keyword_for_lot(lot) or "__all_active__"
            matches_by_keyword[keyword] = matches_by_keyword.get(keyword, 0) + 1
        self.log.info("platform_search_finished", platform=platform.name, lots=len(lots), skipped_min_amount=skipped_min_amount, matches_by_keyword=matches_by_keyword)
        return lots

    def _apply_keyword_min_amount_filter(self, lots: list[TenderLot]) -> tuple[list[TenderLot], int]:
        result: list[TenderLot] = []
        skipped = 0
        for lot in lots:
            if self._passes_keyword_min_amount(lot):
                result.append(lot)
            else:
                skipped += 1
        return result, skipped

    def _passes_keyword_min_amount(self, lot: TenderLot) -> bool:
        keyword = self._keyword_for_lot(lot)
        min_amount = self.keywords.min_amount_for(keyword)
        if min_amount is None:
            return True
        amount = self._decimal_or_none(lot.amount)
        lot.raw = {**lot.raw, "keyword_min_amount": str(min_amount)}
        if amount is None:
            lot.raw = {
                **lot.raw,
                "keyword_min_amount_passed": False,
                "keyword_min_amount_reason": "Сумма лота не указана",
            }
            return False
        if amount >= min_amount:
            lot.raw = {**lot.raw, "keyword_min_amount_passed": True}
            return True
        lot.raw = {
            **lot.raw,
            "keyword_min_amount_passed": False,
            "keyword_min_amount_reason": f"Сумма лота {amount} ниже порога {min_amount}",
        }
        return False

    def _keyword_for_lot(self, lot: TenderLot) -> str | None:
        value = lot.raw.get("keyword_match_keyword") or lot.raw.get("matched_keyword") or lot.raw.get("keyword")
        text = str(value or "").strip()
        return text or None

    def _decimal_or_none(self, value: Any) -> Decimal | None:
        if value is None:
            return None
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value).replace("\u00a0", " ").replace(" ", "").replace(",", "."))
        except (InvalidOperation, ValueError):
            return None

    def _ai_context_keywords(self, keywords: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for keyword in [*self.settings.ai_context_keywords, *keywords]:
            item = str(keyword).strip()
            key = item.lower()
            if item and key not in seen:
                seen.add(key)
                result.append(item)
        return result[:80]

    def _process_lot(self, platform: TenderPlatform, lot: TenderLot) -> bool:
        self.log.info("lot_process_started", platform=platform.name, lot=lot.stable_id, keyword_match=lot.raw.get("keyword_match"))
        existing_raw = self.db.load_lot_raw(lot.stable_id)
        if existing_raw:
            lot.raw = {**existing_raw, **lot.raw}
        enriched = lot
        try:
            enriched = platform.enrich(lot)
        except Exception as exc:
            self.log.warning("lot_enrich_failed", platform=platform.name, lot=lot.stable_id, error=str(exc))
        self._update_dictionary_last_lot(enriched)
        if self._reject_by_stop_word(enriched):
            is_new, changes = self.db.upsert_lot(enriched)
            self.log.info("lot_process_finished", platform=platform.name, lot=enriched.stable_id, is_new=is_new, changes=changes, rejected_by_stop_word=True)
            return is_new or bool(changes)
        try:
            self._process_spec_documents(enriched)
        except Exception as exc:
            self.log.warning("lot_spec_processing_failed", lot=enriched.stable_id, error=str(exc))
        self._analyze_lot_with_ai(enriched)
        suitable = self._is_suitable(enriched)
        if suitable:
            enriched = platform.load_final_protocol(enriched)
            suitable = self._is_suitable(enriched)
        is_new, changes = self.db.upsert_lot(enriched)
        if suitable and is_new:
            self.notifications.lot_created(enriched)
        elif suitable and changes:
            self.notifications.lot_changed(enriched, changes)
        if suitable:
            self._process_protocol_documents(enriched)
        if suitable and enriched.winner_bin:
            self.notifications.winner_detected(enriched)
        self.log.info("lot_process_finished", platform=platform.name, lot=enriched.stable_id, is_new=is_new, changes=changes)
        return is_new or bool(changes)

    def _update_dictionary_last_lot(self, lot: TenderLot) -> None:
        keyword = self._keyword_for_lot(lot)
        last_lot = lot.raw.get("lot_source_id") or lot.raw.get("lot") or lot.external_id
        if keyword and last_lot:
            self.keywords.update_last_lot(keyword, str(last_lot))

    def _is_suitable(self, lot: TenderLot) -> bool:
        return lot.raw.get("is_suitable") is True

    def _reject_by_stop_word(self, lot: TenderLot) -> bool:
        stop_word = self.keywords.find_stop_word(self._stop_word_text(lot), self._stop_words)
        if not stop_word:
            return False
        reason = f"Лот исключен по стоп-слову из справочника: {stop_word}"
        lot.raw = {
            **lot.raw,
            "ai_filter": {
                "is_suitable": False,
                "score": 0,
                "matched_theme": "Стоп-слово",
                "reason": reason,
                "required_services": [],
                "positive_reasons": [],
                "negative_reasons": [reason],
                "recommendation": "Не добавлять в Подходящие.",
                "spec_context_used": bool(lot.raw.get("spec_text_sample") or lot.raw.get("spec_summary")),
            },
            "ai_filter_status": "stop_word",
            "ai_score": 0,
            "ai_passed": False,
            "is_suitable": False,
            "matched_keyword": None,
            "match_score": 0,
            "match_method": "stop_word",
            "match_reason": reason,
            "stop_word": stop_word,
        }
        return True

    def _stop_word_text(self, lot: TenderLot) -> str:
        # Стоп-слова фильтруют по ПРЕДМЕТУ закупки (название/описание/тип), а не по
        # полному тексту ТС. Раньше сюда входили spec_text_sample/spec_summary/
        # spec_services — из-за этого случайное слово вроде "обучение" или "поддержка"
        # в бойлерплейте квалификационных требований ТС отклоняло релевантные лоты
        # (например, "аренда серверного оборудования / хранение резервных копий в ЦОД").
        values = [
            lot.title,
            lot.description,
            lot.purchase_type,
        ]
        return " ".join(str(value or "") for value in values)

    def _analyze_lot_with_ai(self, lot: TenderLot) -> None:
        if self._reject_by_stop_word(lot):
            return
        if not self.settings.ai_lot_filter_enabled:
            return
        if lot.raw.get("manual_suitable_removed") is True:
            lot.raw = {
                **lot.raw,
                "is_suitable": False,
                "ai_passed": False,
                "matched_keyword": None,
                "match_score": 0,
                "match_method": "manual_removed",
                "match_reason": "Удалено пользователем из Подходящих",
                "ai_filter_status": "manual_removed",
            }
            return
        if not self.ai_suitability.enabled:
            self.log.warning("ai_lot_filter_not_configured", lot=lot.stable_id, provider=self.ai_suitability.provider_name)
            return
        if self.settings.ai_require_spec_text and not self._has_spec_context(lot):
            infosec_signals = self._card_infosec_signals(lot)
            if infosec_signals:
                evidence = ", ".join(infosec_signals[:8])
                review_only = any(signal in SECURITY_SERVICE_REVIEW_TERMS for signal in infosec_signals) and not any(
                    signal in INFOSEC_RELEVANCE_TERMS for signal in infosec_signals
                )
                if review_only:
                    reason = (
                        "Карточка лота содержит услуги по обеспечению безопасности, но текст ТС не удалось получить "
                        "или извлечь. Лот не скрыт как нерелевантный ноль, требуется ручная проверка на ИБ."
                    )
                    matched_theme = "Безопасность / требуется уточнение ИБ"
                    required_services = ["Информационная безопасность (уточнить по ТС)"]
                    positive_reasons = ["В карточке есть формулировка услуг по обеспечению безопасности."]
                    match_score = 0.5
                else:
                    reason = (
                        "Карточка лота содержит признаки информационной безопасности, но текст ТС не удалось получить "
                        f"или извлечь. Найденные признаки: {evidence}."
                    )
                    matched_theme = "Информационная безопасность / требуется ТС"
                    required_services = ["Информационная безопасность"]
                    positive_reasons = ["В карточке есть признаки ИБ/кибербезопасности."]
                    match_score = 0.5
                lot.raw = {
                    **lot.raw,
                    "ai_filter": {
                        "is_suitable": False,
                        "score": 50,
                        "matched_theme": matched_theme,
                        "reason": reason,
                        "required_services": required_services,
                        "positive_reasons": positive_reasons,
                        "negative_reasons": ["Нет прочитанной ТС для финального подтверждения состава услуг."],
                        "recommendation": "Оставить во вкладке Все и проверить ТС вручную; не скрывать как нерелевантный ноль.",
                        "spec_context_used": False,
                        "spec_evidence": evidence,
                    },
                    "ai_filter_status": "no_spec_text_infosec_card",
                    "ai_provider": self.ai_suitability.provider_name,
                    "ai_score": 50,
                    "ai_passed": False,
                    "is_suitable": False,
                    "matched_keyword": matched_theme,
                    "match_score": match_score,
                    "match_method": "card_infosec_no_spec",
                    "match_reason": reason,
                }
                return
            reason = "Текст технической спецификации не удалось получить или извлечь, поэтому AI не может надежно подтвердить соответствие услугам Tender."
            lot.raw = {
                **lot.raw,
                "ai_filter": {
                    "is_suitable": False,
                    "score": 0,
                    "matched_theme": "ТС не прочитана",
                    "reason": reason,
                    "required_services": [],
                    "positive_reasons": [],
                    "negative_reasons": ["Нет прочитанной ТС для проверки состава услуг."],
                    "recommendation": "Оставить во вкладке Все и проверить документ вручную, если лот выглядит важным.",
                    "spec_context_used": False,
                },
                "ai_filter_status": "no_spec_text",
                "ai_provider": self.ai_suitability.provider_name,
                "ai_score": 0,
                "ai_passed": False,
                "is_suitable": False,
                "matched_keyword": None,
                "match_score": 0,
                "match_method": None,
                "match_reason": reason,
            }
            return
        if self.settings.ai_require_spec_text:
            spec_signals = self._spec_relevance_signals(lot)
            lot.raw = {**lot.raw, "spec_relevance_signals": spec_signals}
        if self._cooldown_active(self._ai_cooldown_until):
            lot.raw = {**lot.raw, "ai_filter_status": "cooldown"}
            return
        previous_ai_completed = (
            lot.raw.get("ai_provider") == self.ai_suitability.provider_name
            and lot.raw.get("ai_filter_status") == "ok"
            and isinstance(lot.raw.get("is_suitable"), bool)
            and isinstance(lot.raw.get("ai_score"), (int, float))
        )
        with self._ai_lock:
            if self._cooldown_active(self._ai_cooldown_until):
                lot.raw = {**lot.raw, "ai_filter_status": "cooldown"}
                return
            self._wait_for_ai_delay()
            try:
                result = self.ai_suitability.analyze(lot)
                self._last_ai_request_at = time.monotonic()
            except Exception as exc:
                self._last_ai_request_at = time.monotonic()
                status = "error"
                if self._looks_like_rate_limit(exc):
                    self._ai_cooldown_until = time.monotonic() + self.settings.ai_rate_limit_cooldown_seconds
                    status = "rate_limited"
                if previous_ai_completed:
                    lot.raw = {
                        **lot.raw,
                        "ai_last_error": str(exc),
                        "ai_last_error_status": status,
                        "ai_last_error_at": datetime.now(timezone.utc).isoformat(),
                    }
                    self.log.warning(
                        "ai_lot_filter_failed",
                        lot=lot.stable_id,
                        error=str(exc),
                        preserved_previous=True,
                    )
                    return
                lot.raw = {
                    **lot.raw,
                    "ai_filter_status": status,
                    "ai_provider": self.ai_suitability.provider_name,
                    "ai_score": 0,
                    "ai_passed": False,
                    "is_suitable": False,
                    "matched_keyword": None,
                    "match_score": 0,
                    "match_reason": str(exc),
                }
                self.log.warning("ai_lot_filter_failed", lot=lot.stable_id, error=str(exc))
                return
        score = int(result.get("score") or 0)
        passed = bool(result.get("passed"))
        is_suitable = passed
        matched_keyword = str(result.get("matched_theme") or "AI semantic match") if is_suitable else None
        has_spec_context = bool(lot.raw.get("spec_services") or lot.raw.get("spec_summary") or lot.raw.get("spec_text_sample"))
        cleaned_raw = dict(lot.raw)
        for key in ("ai_last_error", "ai_last_error_status", "ai_last_error_at"):
            cleaned_raw.pop(key, None)
        lot.raw = {
            **cleaned_raw,
            "ai_filter": result,
            "ai_filter_status": "ok",
            "ai_score": score,
            "ai_passed": passed,
            "ai_provider": self.ai_suitability.provider_name,
            "is_suitable": is_suitable,
            "matched_keyword": matched_keyword,
            "match_score": score / 100,
            "match_method": "ai_spec_services" if passed and has_spec_context else ("ai_semantic" if passed else None),
            "match_reason": result.get("reason"),
        }

    def _wait_for_ai_delay(self) -> None:
        delay = self.settings.ai_request_delay_seconds
        if delay <= 0:
            return
        elapsed = time.monotonic() - self._last_ai_request_at
        if elapsed < delay:
            time.sleep(delay - elapsed)

    def _has_spec_context(self, lot: TenderLot) -> bool:
        return bool(str(lot.raw.get("spec_text_sample") or "").strip()) or isinstance(lot.raw.get("spec_summary"), dict)

    def _card_infosec_signals(self, lot: TenderLot) -> list[str]:
        text = " ".join(
            str(value or "")
            for value in [
                lot.title,
                lot.description,
                lot.purchase_type,
                lot.customer_name,
                lot.organizer_name,
                lot.raw.get("match_text"),
                lot.raw.get("keyword_match_keyword"),
                lot.raw.get("matched_keyword"),
            ]
        ).lower()
        signals: list[str] = []
        for term in INFOSEC_RELEVANCE_TERMS:
            if term in text and term not in signals:
                signals.append(term)
            if len(signals) >= 12:
                break
        if signals:
            return signals
        if any(term in text for term in PHYSICAL_SECURITY_NEGATIVE_TERMS):
            return []
        for term in SECURITY_SERVICE_REVIEW_TERMS:
            if term in text and term not in signals:
                signals.append(term)
            if len(signals) >= 6:
                break
        return signals

    def _spec_relevance_signals(self, lot: TenderLot) -> list[str]:
        text = " ".join(
            str(value or "")
            for value in [
                lot.raw.get("spec_text_sample"),
                lot.raw.get("spec_summary"),
                lot.raw.get("spec_services"),
                lot.title,
                lot.description,
            ]
        ).lower()
        signals: list[str] = []
        for term in STRONG_SPEC_RELEVANCE_TERMS:
            if term in text and term not in signals:
                signals.append(term)
            if len(signals) >= 24:
                break
        return signals

    def _fallback_services_from_lot(self, lot: TenderLot) -> list[str]:
        text = " ".join(str(value or "") for value in [lot.title, lot.description, lot.purchase_type]).lower()
        if "кофе" in text:
            return ["Поставка товара: кофе"]
        if "видеокамер" in text or "камера" in text:
            return ["Поставка видеокамер / оборудования видеонаблюдения"]
        if "компьютер" in text:
            return ["Поставка компьютерного оборудования"]
        if "лиценз" in text:
            return ["Лицензии / программный продукт"]
        return ["Услуги по ТС не относятся к профилю Tender"]

    def _cooldown_active(self, cooldown_until: float) -> bool:
        return cooldown_until > time.monotonic()

    def _looks_like_rate_limit(self, exc: Exception) -> bool:
        text = str(exc).lower()
        return "429" in text or "too many requests" in text or "quota" in text or "лимит" in text or "rate limit" in text

    def _process_spec_documents(self, lot: TenderLot) -> None:
        docs = self.documents.pick_spec_documents(lot)
        lot.raw = {
            **lot.raw,
            "spec_documents_checked": [{"name": doc.name, "url": doc.url} for doc in docs],
        }
        if lot.source == "tenderplus":
            max_docs = self.settings.tenderplus_document_max_downloads
            if max_docs <= 0:
                lot.raw = {
                    **lot.raw,
                    "spec_processing_status": "document_download_disabled",
                    "spec_processed_at": datetime.now(timezone.utc).isoformat(),
                }
                return
            docs = docs[:max_docs]
        if not docs:
            lot.raw = {
                **lot.raw,
                "spec_processing_status": "no_supported_documents",
                "spec_processed_at": datetime.now(timezone.utc).isoformat(),
            }
            return
        attempted = 0
        text_found = False
        last_error = ""
        for doc in docs:
            text_chars: int | None = None
            rag_indexed = False
            spec_summary: dict[str, Any] | None = None
            attempted += 1
            try:
                data, downloaded = self.documents.download(lot, doc)
            except Exception as exc:
                last_error = str(exc)
                self.log.warning("document_download_skipped", lot=lot.stable_id, document=doc.name, error=str(exc))
                continue
            try:
                extracted = self.documents.extract_text(downloaded, data)
                text_chars = len(extracted)
                if extracted.strip():
                    text_found = True
                    lot.raw = {
                        **lot.raw,
                        "spec_text_sample": extracted.strip()[: self.settings.ai_spec_text_max_chars],
                        "spec_text_chars": text_chars,
                        "spec_document_name": downloaded.name,
                        "spec_document_sha256": downloaded.sha256,
                    }
            except Exception as exc:
                last_error = str(exc)
                self.log.warning("document_text_extract_failed", lot=lot.stable_id, document=doc.name, error=str(exc))
            if lot.source == "tenderplus" and not self.settings.tenderplus_rag_index_documents:
                lot.raw = {
                    **lot.raw,
                    "spec_processing_status": "text_extracted" if text_chars else "text_extract_empty",
                    "spec_processed_at": datetime.now(timezone.utc).isoformat(),
                }
                self.db.upsert_document(lot, downloaded, text_chars=text_chars, rag_indexed=False)
                if text_chars:
                    break
                continue
            if downloaded.local_path:
                try:
                    if (
                        downloaded.sha256
                        and lot.raw.get("spec_summary_sha256") == downloaded.sha256
                        and isinstance(lot.raw.get("spec_summary"), dict)
                    ):
                        result = {"indexed": True, "spec_summary": lot.raw.get("spec_summary")}
                    else:
                        result = self._index_spec_document(lot, downloaded.local_path, f"{lot.source};auto_spec;{downloaded.name}")
                    if result is not None:
                        rag_indexed = bool(result.get("indexed"))
                        text_chars = int(result.get("text_chars") or text_chars or 0)
                        payload = result.get("spec_summary")
                        if isinstance(payload, dict):
                            spec_summary = payload
                            services = payload.get("services")
                            lot.raw = {
                                **lot.raw,
                                "spec_summary": payload,
                                "spec_services": services if isinstance(services, list) else [],
                                "spec_summary_sha256": downloaded.sha256,
                                "spec_summary_provider": payload.get("provider"),
                                "spec_processing_status": "ok",
                                "spec_processed_at": datetime.now(timezone.utc).isoformat(),
                            }
                        if rag_indexed:
                            self.notifications.rag_indexed(lot, downloaded.name, text_chars)
                except Exception as exc:
                    self.log.warning("rag_index_failed", lot=lot.stable_id, document=doc.name, error=str(exc))
            self.db.upsert_document(lot, downloaded, text_chars=text_chars, rag_indexed=rag_indexed)
            if spec_summary is not None:
                break
        if not text_found:
            lot.raw = {
                **lot.raw,
                "spec_processing_status": "document_text_unavailable" if attempted else "no_supported_documents",
                "spec_processing_error": last_error,
                "spec_processed_at": datetime.now(timezone.utc).isoformat(),
            }

    def _index_spec_document(self, lot: TenderLot, local_path: str, source_hint: str) -> dict[str, Any] | None:
        if self._cooldown_active(self._rag_cooldown_until):
            lot.raw = {**lot.raw, "spec_processing_status": "rag_cooldown", "spec_processed_at": datetime.now(timezone.utc).isoformat()}
            return None
        with self._rag_lock:
            if self._cooldown_active(self._rag_cooldown_until):
                lot.raw = {**lot.raw, "spec_processing_status": "rag_cooldown", "spec_processed_at": datetime.now(timezone.utc).isoformat()}
                return None
            max_requests = self.settings.rag_spec_ai_max_per_cycle
            if max_requests > 0 and self._rag_spec_ai_requests_this_cycle >= max_requests:
                lot.raw = {**lot.raw, "spec_processing_status": "rag_cycle_budget_exhausted", "spec_processed_at": datetime.now(timezone.utc).isoformat()}
                return None
            self._wait_for_rag_delay()
            self._rag_spec_ai_requests_this_cycle += 1
            try:
                result = self.rag.index_document(lot.stable_id, local_path, source_hint)
                self._last_rag_request_at = time.monotonic()
                return result
            except Exception as exc:
                self._last_rag_request_at = time.monotonic()
                if self._looks_like_rate_limit(exc):
                    self._rag_cooldown_until = time.monotonic() + self.settings.rag_rate_limit_cooldown_seconds
                    lot.raw = {**lot.raw, "spec_processing_status": "rag_rate_limited", "spec_processed_at": datetime.now(timezone.utc).isoformat()}
                raise

    def _wait_for_rag_delay(self) -> None:
        delay = self.settings.ai_request_delay_seconds
        if delay <= 0:
            return
        elapsed = time.monotonic() - self._last_rag_request_at
        if elapsed < delay:
            time.sleep(delay - elapsed)

    def _process_documents(self, lot: TenderLot) -> None:
        self._process_spec_documents(lot)
        self._process_protocol_documents(lot)

    def _process_protocol_documents(self, lot: TenderLot) -> None:
        for doc in self.documents.pick_protocol_documents(lot):
            try:
                data, downloaded = self.documents.download(lot, doc)
                text = self.documents.extract_text(downloaded, data)
                before = lot.winner_bin
                enrich_winner_from_text(lot, text)
                self.db.upsert_document(lot, downloaded, text_chars=len(text), rag_indexed=False)
                if lot.winner_bin and lot.winner_bin != before:
                    self.db.upsert_lot(lot)
                    self.notifications.winner_detected(lot)
            except Exception as exc:
                self.log.warning("protocol_process_failed", lot=lot.stable_id, document=doc.name, error=str(exc))
