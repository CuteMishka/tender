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
        self.keywords = KeywordService(db, settings.default_keywords)
        self.documents = DocumentService(settings.download_dir, settings.request_timeout_seconds)
        self.rag = RagClient(
            settings.rag_api_base,
            settings.request_timeout_seconds,
            settings.rag_extract_spec_points,
            settings.rag_include_extracted_text,
        )
        self.notifications = NotificationService(db, settings.our_bins)
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
            time.sleep(sleep_for)

    def run_once(self) -> None:
        keywords = self.keywords.load_active()
        platform_names = [platform.name for platform in self.platforms]
        run_id = self.db.start_run(platform_names, keywords)
        lots_found = 0
        lots_changed = 0
        errors: list[dict[str, Any]] = []
        self.log.info("parser_cycle_started", run_id=run_id, keywords=len(keywords), platforms=platform_names)
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
            for platform, lots in search_results:
                work.extend((platform, lot) for lot in lots)
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
        self.log.info("platform_search_started", platform=platform.name)
        lots = platform.search(keywords)
        self.log.info("platform_search_finished", platform=platform.name, lots=len(lots))
        return lots

    def _process_lot(self, platform: TenderPlatform, lot: TenderLot) -> bool:
        self.log.info("lot_process_started", lot=lot.stable_id)
        enriched = platform.enrich(lot)
        enriched = platform.load_final_protocol(enriched)
        is_new, changes = self.db.upsert_lot(enriched)
        if is_new:
            self.notifications.lot_created(enriched)
        elif changes:
            self.notifications.lot_changed(enriched, changes)
        self._process_documents(enriched)
        if enriched.winner_bin:
            self.notifications.winner_detected(enriched)
        self.log.info("lot_process_finished", lot=enriched.stable_id, is_new=is_new, changes=changes)
        return is_new or bool(changes)

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
