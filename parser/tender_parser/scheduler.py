import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import structlog

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
        self.keywords = KeywordService(db, settings.default_keywords, settings.dictionaries_api_url, settings.request_timeout_seconds)
        self.documents = DocumentService(settings.download_dir, settings.request_timeout_seconds)
        self.rag = RagClient(
            settings.rag_api_base,
            settings.request_timeout_seconds,
            settings.rag_extract_spec_points,
            settings.rag_include_extracted_text,
        )
        self.notifications = NotificationService(db, settings.our_bins, settings.telegram_bot_token, settings.telegram_chat_id, settings.request_timeout_seconds)
        self.platforms = build_platforms(settings)

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
            request_id = self.db.claim_run_request()
            if request_id is not None:
                self.log.info("manual_parser_run_requested", request_id=request_id)
                try:
                    self.run_once()
                    self.db.finish_run_request(request_id, "completed")
                    self.log.info("manual_parser_run_finished", request_id=request_id)
                except Exception as exc:
                    self.db.finish_run_request(request_id, "failed", str(exc))
                    self.log.exception("manual_parser_run_failed", request_id=request_id, error=str(exc))
                deadline = time.monotonic() + self.settings.poll_interval_seconds
            time.sleep(min(5, max(0, deadline - time.monotonic())))

    def run_once(self) -> None:
        keywords = self.keywords.load_active()
        platform_names = [platform.name for platform in self.platforms]
        run_id = self.db.start_run(platform_names, keywords)
        lots_found = 0
        lots_changed = 0
        errors: list[dict[str, Any]] = []
        self.log.info("parser_cycle_started", run_id=run_id, keywords_count=len(keywords), keywords=keywords, platforms=platform_names, collect_all_active_lots=self.settings.collect_all_active_lots)
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
            for platform, lots in search_results:
                limit = remaining if remaining > 0 else 0
                skipped_seen = 0
                if self.settings.process_existing_lots:
                    selected = lots[:limit] if limit > 0 else lots
                else:
                    selected, skipped_seen = self.db.filter_new_lots(lots, self.settings.stop_at_first_seen_lot, limit)
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

    def _search_platform(self, platform: TenderPlatform, keywords: list[str]) -> list[TenderLot]:
        self.log.info("platform_search_started", platform=platform.name, strict_keyword_filter=self.settings.strict_keyword_filter, collect_all_active_lots=self.settings.collect_all_active_lots)
        lots = platform.search(keywords, self.db.lot_exists)
        matches_by_keyword: dict[str, int] = {}
        for lot in lots:
            keyword = "__all_active__"
            if self._is_suitable(lot):
                keyword = str(lot.raw.get("matched_keyword") or lot.raw.get("keyword") or "__suitable__")
            matches_by_keyword[keyword] = matches_by_keyword.get(keyword, 0) + 1
        self.log.info("platform_search_finished", platform=platform.name, lots=len(lots), matches_by_keyword=matches_by_keyword)
        return lots

    def _process_lot(self, platform: TenderPlatform, lot: TenderLot) -> bool:
        self.log.info("lot_process_started", platform=platform.name, lot=lot.stable_id, matched_keyword=lot.raw.get("matched_keyword"))
        suitable = self._is_suitable(lot)
        enriched = lot
        if suitable:
            enriched = platform.enrich(lot)
            enriched = platform.load_final_protocol(enriched)
        if suitable:
            self._analyze_lot_with_ai(enriched)
        is_new, changes = self.db.upsert_lot(enriched)
        if suitable and is_new:
            self.notifications.lot_created(enriched)
        elif suitable and changes:
            self.notifications.lot_changed(enriched, changes)
        if suitable:
            self._process_documents(enriched)
        if suitable and enriched.winner_bin:
            self.notifications.winner_detected(enriched)
        self.log.info("lot_process_finished", platform=platform.name, lot=enriched.stable_id, is_new=is_new, changes=changes)
        return is_new or bool(changes)

    def _is_suitable(self, lot: TenderLot) -> bool:
        return lot.raw.get("is_suitable") is True

    def _analyze_lot_with_ai(self, lot: TenderLot) -> None:
        if not self.settings.ai_lot_filter_enabled:
            return
        lot_text = "\n".join(
            part for part in [
                lot.title,
                lot.description,
                lot.customer_name or "",
                lot.organizer_name or "",
                lot.purchase_type or "",
                lot.place or "",
                str(lot.amount or ""),
                str(lot.raw.get("match_text") or ""),
            ] if part
        )
        try:
            result = self.rag.analyze_lot(lot_text[:18000], self.settings.ai_company_profile)
        except Exception as exc:
            self.log.warning("ai_lot_filter_failed", lot=lot.stable_id, error=str(exc))
            return
        score = int(result.get("score") or 0)
        lot.raw = {
            **lot.raw,
            "ai_filter": result,
            "ai_score": score,
            "ai_passed": score >= self.settings.ai_lot_filter_min_score,
        }

    def _process_documents(self, lot: TenderLot) -> None:
        docs = self.documents.pick_spec_documents(lot)
        for doc in docs:
            text_chars: int | None = None
            rag_indexed = False
            try:
                data, downloaded = self.documents.download(lot, doc)
            except Exception as exc:
                self.log.warning("document_download_skipped", lot=lot.stable_id, document=doc.name, error=str(exc))
                continue
            try:
                extracted = self.documents.extract_text(downloaded, data)
                text_chars = len(extracted)
            except Exception as exc:
                self.log.warning("document_text_extract_failed", lot=lot.stable_id, document=doc.name, error=str(exc))
            if downloaded.local_path:
                try:
                    result = self.rag.index_document(lot.stable_id, downloaded.local_path, f"{lot.source};{downloaded.name}")
                    rag_indexed = bool(result.get("indexed"))
                    text_chars = int(result.get("text_chars") or text_chars or 0)
                    if rag_indexed:
                        self.notifications.rag_indexed(lot, downloaded.name, text_chars)
                except Exception as exc:
                    self.log.warning("rag_index_failed", lot=lot.stable_id, document=doc.name, error=str(exc))
            self.db.upsert_document(lot, downloaded, text_chars=text_chars, rag_indexed=rag_indexed)
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
