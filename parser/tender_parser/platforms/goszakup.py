import re
from collections.abc import Callable
from urllib.parse import urlencode

import structlog
from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from tender_parser.config import Settings
from tender_parser.matching import SmartMatcher
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import absolute_url, clean_text, find_first_regex, html_text, parse_amount, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class GoszakupPlatform(TenderPlatform):
    name = "goszakup"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.log = structlog.get_logger("tender_parser.goszakup")

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        lots: dict[str, TenderLot] = {}
        matcher = self._build_matcher(keywords)
        search_terms = self._search_terms(keywords)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless, args=self._chromium_args())
            context = browser.new_context(
                locale="ru-RU",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                viewport={"width": 1440, "height": 1000},
                extra_http_headers={"Accept-Language": "ru-RU,ru;q=0.9,kk;q=0.8,en;q=0.7"},
            )
            page = context.new_page()
            try:
                for keyword in search_terms:
                    page_number = 1
                    seen_page_signatures: set[tuple[str, ...]] = set()
                    stop_all = False
                    while self.settings.goszakup_lots_max_pages == 0 or page_number <= self.settings.goszakup_lots_max_pages:
                        if stop_all:
                            break
                        url = self._search_url(page_number, keyword)
                        self._goto(page, url)
                        html = page.content()
                        page_lots = self._parse_search_html(html, keyword)
                        if not page_lots:
                            self._log_page_diagnostics(url, page.url, html, page_lots)
                            break
                        page_signature = tuple(lot.stable_id for lot in page_lots)
                        if page_signature in seen_page_signatures:
                            self._log_page_diagnostics(url, page.url, html, page_lots)
                            self.log.info("goszakup_repeated_page_detected", requested_url=page.url, parsed_lots=len(page_lots))
                            break
                        seen_page_signatures.add(page_signature)
                        added_on_page = 0
                        for lot in page_lots:
                            if is_seen and self.settings.stop_at_first_seen_lot and is_seen(lot.stable_id):
                                stop_all = True
                                break
                            if not self._is_active_lot(lot):
                                continue
                            match_text = str(lot.raw.get("match_text") or lot.title)
                            match = matcher.match(match_text, keyword)
                            if self.settings.strict_keyword_filter and not self.settings.collect_all_active_lots and not match.matched:
                                continue
                            lot.raw.update({
                                "matched_keyword": match.keyword if match.matched else None,
                                "candidate_keyword": match.keyword,
                                "match_score": round(match.score, 4),
                                "match_method": match.method,
                                "match_reason": match.reason,
                                "is_suitable": match.matched,
                            })
                            if lot.stable_id not in lots:
                                added_on_page += 1
                            lots[lot.stable_id] = lot
                        self.log.info("goszakup_page_parsed", requested_url=url, final_url=page.url, page=page_number, parsed=len(page_lots), added=added_on_page)
                        page_number += 1
            finally:
                context.close()
                browser.close()
        return list(lots.values())

    def enrich(self, lot: TenderLot) -> TenderLot:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless, args=self._chromium_args())
            context = browser.new_context(
                locale="ru-RU",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                viewport={"width": 1440, "height": 1000},
                extra_http_headers={"Accept-Language": "ru-RU,ru;q=0.9,kk;q=0.8,en;q=0.7"},
            )
            page = context.new_page()
            try:
                announce_url = str(lot.raw.get("announce_url") or lot.url)
                lot_url = str(lot.raw.get("lot_url") or lot.url)
                lot_html = ""
                announce_candidates: list[str] = []
                if lot_url:
                    self._goto(page, lot_url)
                    lot_html = page.content()
                    self._apply_lot_detail(lot, lot_html)
                    announce_candidates.extend(self._extract_announce_urls(lot_html))
                    announce_candidates.extend(self._extract_announce_urls(page.url))
                announce_candidates.append(announce_url)
                announce_candidates = self._dedupe_urls(announce_candidates)
                used_announce_url = announce_candidates[0] if announce_candidates else announce_url
                documents_url = self._tab_url(used_announce_url, "documents")
                detail_text_parts = [lot_html]
                documents_found = False
                for candidate_url in announce_candidates:
                    self._goto(page, candidate_url)
                    announce_html = page.content()
                    detail_text_parts.append(announce_html)
                    self._apply_announce_detail(lot, announce_html)
                    before_count = len(lot.documents)
                    lot.documents = self._dedupe_documents([*lot.documents, *self._parse_documents_html(announce_html, candidate_url, page)])
                    candidate_documents_url = self._tab_url(candidate_url, "documents")
                    self._goto(page, candidate_documents_url)
                    documents_html = page.content()
                    detail_text_parts.append(documents_html)
                    lot.documents = self._dedupe_documents([*lot.documents, *self._parse_documents_html(documents_html, candidate_url, page)])
                    protocols_url = self._tab_url(candidate_url, "protocols")
                    self._goto(page, protocols_url)
                    protocols_html = page.content()
                    detail_text_parts.append(protocols_html)
                    lot.documents = self._dedupe_documents([*lot.documents, *self._parse_documents_html(protocols_html, candidate_url, page)])
                    if len(lot.documents) > before_count:
                        documents_found = True
                        used_announce_url = candidate_url
                        documents_url = candidate_documents_url
                        break
                body = html_text(" ".join(detail_text_parts))
                lot.complaints_count = self._extract_complaints_count(body) or lot.complaints_count
                lot.raw = {
                    **lot.raw,
                    "announce_url": used_announce_url,
                    "announce_candidates": announce_candidates,
                    "detail_text_sample": body[:4000],
                    "documents_url": documents_url,
                    "documents_found": documents_found,
                }
                return lot
            finally:
                context.close()
                browser.close()

    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        if not self._looks_completed(lot):
            return lot
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless, args=self._chromium_args())
            context = browser.new_context(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0", viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            try:
                announce_url = str(lot.raw.get("announce_url") or lot.url)
                self._goto(page, self._tab_url(announce_url, "protocols"))
                text = html_text(page.content())
                winner_bin = find_first_regex(text, r"(?:БИН|ИИН)\s*(?:победителя)?\s*[:№#-]?\s*(\d{12})")
                if winner_bin:
                    lot.winner_bin = winner_bin
                winner_name = find_first_regex(text, r"Победител[ья]\s*[:№#-]?\s*([^\n\r]{4,160})")
                if winner_name:
                    lot.winner_name = clean_text(winner_name)
                return lot
            finally:
                context.close()
                browser.close()

    def _search_terms(self, keywords: list[str]) -> list[str | None]:
        if self.settings.collect_all_active_lots:
            return [None]
        return [keyword for keyword in keywords if keyword.strip()]

    def _search_url(self, page_number: int, keyword: str | None) -> str:
        params = {
            "count_record": self.settings.goszakup_lots_count_record,
            "page": page_number,
        }
        if keyword:
            params["filter[name]"] = keyword
        return f"{self.settings.goszakup_search_url}?{urlencode(params)}"

    def _goto(self, page, url: str):
        response = page.goto(url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
        try:
            page.wait_for_selector("#search-result, table", timeout=min(self.settings.request_timeout_seconds * 1000, 30000))
        except PlaywrightTimeoutError:
            self.log.warning("goszakup_page_ready_timeout", url=page.url)
        page.wait_for_timeout(700)
        self.log.info("goszakup_navigation_finished", requested_url=url, final_url=page.url, status=response.status if response else None)
        return response

    def _parse_search_html(self, html: str, keyword: str | None) -> list[TenderLot]:
        soup = BeautifulSoup(html, "lxml")
        rows = soup.select("#search-result tbody tr")
        lots: list[TenderLot] = []
        for row in rows:
            cells = row.find_all("td", recursive=False)
            if len(cells) < 7:
                continue
            lot_number_text = clean_text(cells[0].get_text(" ", strip=True))
            external_id = self._extract_visible_lot_id(lot_number_text)
            announce_link = cells[1].select_one("a[href*='/ru/announce/index/']")
            lot_link = cells[2].select_one("a[href*='/ru/subpriceoffer/index/']")
            if not external_id or not announce_link:
                continue
            announce_href = announce_link.get("href") or ""
            lot_href = lot_link.get("href") if lot_link else ""
            announce_url = absolute_url(self.settings.goszakup_base_url, announce_href)
            lot_url = absolute_url(self.settings.goszakup_base_url, lot_href) if lot_href else announce_url
            announce_title = clean_text(announce_link.get_text(" ", strip=True))
            lot_title = clean_text(lot_link.get_text(" ", strip=True)) if lot_link else ""
            customer_name = self._extract_customer(cells[1].get_text(" ", strip=True))
            description = clean_text(cells[2].get_text(" ", strip=True))
            quantity = clean_text(cells[3].get_text(" ", strip=True))
            amount = parse_amount(cells[4].get_text(" ", strip=True))
            purchase_type = clean_text(cells[5].get_text(" ", strip=True)) or None
            status = clean_text(cells[6].get_text(" ", strip=True)) or "active"
            announce_id = self._extract_announce_id(announce_url)
            lot_internal_id = self._extract_subprice_lot_id(lot_url)
            match_text = " ".join(part for part in [lot_number_text, announce_title, lot_title, customer_name or "", description, purchase_type or "", status] if part)
            lots.append(TenderLot(
                source=self.name,
                external_id=external_id,
                url=lot_url,
                title=lot_title or announce_title or f"Лот {external_id}",
                description=description,
                amount=amount,
                customer_name=customer_name,
                organizer_name=customer_name,
                purchase_type=purchase_type,
                status=status[:64],
                raw={
                    "platform": self.name,
                    "source_mode": "browser",
                    "keyword": keyword,
                    "lot_number": lot_number_text,
                    "announce_id": announce_id,
                    "announce_url": announce_url,
                    "announce_title": announce_title,
                    "lot_url": lot_url,
                    "subprice_lot_id": lot_internal_id,
                    "quantity": quantity,
                    "match_text": match_text[:4000],
                    "row_text": clean_text(row.get_text(" ", strip=True))[:2500],
                },
            ))
        return lots

    def _apply_announce_detail(self, lot: TenderLot, html: str) -> None:
        fields = self._fields_from_html(html)
        body = html_text(html)
        title = fields.get("Наименование объявления")
        if title and not lot.title:
            lot.title = title
        lot.purchase_type = self._first_field(fields, ["Способ проведения закупки", "Способ закупки", "Тип закупки"]) or lot.purchase_type
        organizer = self._first_field(fields, ["Организатор", "Наименование организатора"])
        lot.organizer_name = self._strip_bin_prefix(organizer) or lot.organizer_name
        lot.customer_name = lot.customer_name or lot.organizer_name
        lot.amount = parse_amount(self._first_field(fields, ["Сумма закупки", "Запланированная сумма", "Общая сумма"])) or lot.amount
        lot.status = (self._first_field(fields, ["Статус объявления", "Статус лота"]) or lot.status)[:64]
        lot.start_date = parse_datetime(self._first_field(fields, ["Дата начала приема заявок", "Начало приема заявок", "Дата начала представления заявок", "Срок начала приема заявок"])) or lot.start_date
        lot.end_date = parse_datetime(self._first_field(fields, ["Дата окончания приема заявок", "Окончание приема заявок", "Срок окончания приема заявок", "Окончание с", "end_date"])) or lot.end_date
        lot.place = self._first_field(fields, ["Место поставки", "Место выполнения", "Адрес поставки", "Юр. адрес организатора"]) or lot.place
        lot.raw = {
            **lot.raw,
            "announce_fields": fields,
            "announce_text_sample": body[:3000],
        }

    def _apply_lot_detail(self, lot: TenderLot, html: str) -> None:
        fields = self._fields_from_html(html)
        lot.description = self._first_field(fields, ["Дополнительная характеристика", "Краткая характеристика", "Наименование и описание лота", "Описание", "Наименование ТРУ"]) or lot.description
        lot.place = self._first_field(fields, ["Место поставки товара, КАТО", "Место поставки", "Адрес поставки"]) or lot.place
        lot.amount = parse_amount(self._first_field(fields, ["Запланированная сумма", "Сумма 1 год", "Сумма, тг."])) or lot.amount
        lot.start_date = parse_datetime(self._first_field(fields, ["Дата начала приема заявок", "Начало приема заявок", "Срок начала приема заявок"])) or lot.start_date
        lot.end_date = parse_datetime(self._first_field(fields, ["Дата окончания приема заявок", "Окончание приема заявок", "Срок окончания приема заявок", "end_date"])) or lot.end_date
        status = self._first_field(fields, ["Статус лота", "Статус"])
        if status:
            lot.status = status[:64]
        lot.raw = {**lot.raw, "lot_fields": fields}

    def _parse_documents_html(self, html: str, announce_url: str, page) -> list[TenderDocument]:
        soup = BeautifulSoup(html, "lxml")
        docs: list[TenderDocument] = []
        for row in soup.select("table tr"):
            row_text = clean_text(row.get_text(" ", strip=True))
            if not row_text or "Наименование документа" in row_text:
                continue
            for link in row.select("a[href]"):
                href = link.get("href") or ""
                text = clean_text(link.get_text(" ", strip=True))
                lowered = f"{row_text} {text} {href}".lower()
                if href.lower().startswith("javascript:") or "подпись" in lowered or "signature" in lowered:
                    continue
                if any(marker in lowered for marker in ("download", "uploads", "files", ".pdf", ".doc", ".docx", "тех", "специф", "тз", "проект договора", "протокол", "итог", "обеспечение заявки")):
                    docs.append(TenderDocument(name=text or row_text or href.rsplit("/", 1)[-1] or "Документ", url=absolute_url(announce_url, href)))
            for button in row.select("[onclick*='actionModalShowFiles']"):
                onclick = button.get("onclick") or ""
                docs.extend(self._load_modal_documents(page, onclick, row_text, announce_url))
        return self._dedupe_documents(docs)

    def _load_modal_documents(self, page, onclick: str, document_name: str, announce_url: str) -> list[TenderDocument]:
        match = re.search(r"actionModalShowFiles\((\d+)\s*,\s*(\d+)\)", onclick)
        if not match:
            return []
        endpoint = absolute_url(self.settings.goszakup_base_url, f"/ru/announce/actionAjaxModalShowFiles/{match.group(1)}/{match.group(2)}")
        try:
            response = page.request.get(endpoint, timeout=self.settings.request_timeout_seconds * 1000)
            if not response.ok:
                self.log.warning("goszakup_document_modal_failed", url=endpoint, status=response.status)
                return []
            html = response.text()
        except Exception as exc:
            self.log.warning("goszakup_document_modal_error", url=endpoint, error=str(exc))
            return []
        soup = BeautifulSoup(html, "lxml")
        docs: list[TenderDocument] = []
        for link in soup.select("a[href]"):
            href = link.get("href") or ""
            text = clean_text(link.get_text(" ", strip=True))
            lowered = f"{document_name} {text} {href}".lower()
            if "подпись" in lowered or "signature" in lowered:
                continue
            if not any(marker in lowered for marker in ("download", "uploads", ".pdf", ".doc", ".docx", "тех", "специф", "тз", "проект договора", "протокол", "итог")):
                continue
            docs.append(TenderDocument(name=f"{document_name} — {text}" if text else document_name, url=absolute_url(announce_url, href)))
        return docs

    def _fields_from_html(self, html: str) -> dict[str, str]:
        soup = BeautifulSoup(html, "lxml")
        fields: dict[str, str] = {}
        for group in soup.select(".form-group"):
            label_node = group.select_one("label")
            label = clean_text(label_node.get_text(" ", strip=True) if label_node else "")
            value_node = group.select_one("input, textarea, select")
            if value_node:
                value = clean_text(value_node.get("value") or value_node.get_text(" ", strip=True))
            else:
                value = clean_text(group.get_text(" ", strip=True).replace(label, "", 1))
            if label and value:
                fields[label] = value
        for row in soup.select("table tr"):
            cells = row.find_all(["th", "td"], recursive=False)
            if len(cells) < 2:
                continue
            label = clean_text(cells[0].get_text(" ", strip=True))
            value = clean_text(" ".join(cell.get_text(" ", strip=True) for cell in cells[1:]))
            if label and value and label.lower() not in {"наименование документа", "признак"}:
                fields[label] = value
        return fields

    def _build_matcher(self, keywords: list[str]) -> SmartMatcher:
        return SmartMatcher(
            keywords,
            use_morphology=self.settings.smart_match_enabled and self.settings.smart_match_use_morphology,
            semantic_enabled=self.settings.smart_match_enabled and self.settings.semantic_match_enabled,
            semantic_model_name=self.settings.semantic_model_name,
            semantic_threshold=self.settings.semantic_match_threshold,
            min_score=self.settings.min_keyword_score,
        )

    def _chromium_args(self) -> list[str]:
        return [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=AsyncDns",
        ]

    def _is_active_lot(self, lot: TenderLot) -> bool:
        status = (lot.status or "").lower()
        inactive_markers = ("заверш", "итог", "отмен", "не состоя", "архив", "cancel", "complete", "finish", "closed")
        return not any(marker in status for marker in inactive_markers)

    def _looks_completed(self, lot: TenderLot) -> bool:
        status = (lot.status or "").lower()
        return any(marker in status for marker in ("заверш", "итог", "состоя", "completed", "closed", "finished"))

    def _extract_visible_lot_id(self, value: str) -> str | None:
        match = re.search(r"(\d{4,})", value or "")
        return match.group(1) if match else None

    def _extract_announce_id(self, value: str) -> str | None:
        match = re.search(r"/announce/index/(\d+)", value or "")
        return match.group(1) if match else None

    def _extract_subprice_lot_id(self, value: str) -> str | None:
        match = re.search(r"/subpriceoffer/index/\d+/(\d+)", value or "")
        return match.group(1) if match else None

    def _extract_announce_urls(self, value: str) -> list[str]:
        urls: list[str] = []
        for match in re.finditer(r"(?:https://goszakup\.gov\.kz)?/ru/announce/index/(\d+)", value or ""):
            urls.append(absolute_url(self.settings.goszakup_base_url, f"/ru/announce/index/{match.group(1)}"))
        return urls

    def _extract_customer(self, value: str) -> str | None:
        match = re.search(r"Заказчик:\s*(.+?)(?:\s{2,}|$)", clean_text(value))
        return clean_text(match.group(1)) if match else None

    def _strip_bin_prefix(self, value: str | None) -> str | None:
        if not value:
            return None
        return clean_text(re.sub(r"^\d{12}\s+", "", value))

    def _first_field(self, fields: dict[str, str], labels: list[str]) -> str | None:
        normalized = {self._normalize_label(key): value for key, value in fields.items()}
        for label in labels:
            target = self._normalize_label(label)
            if target in normalized:
                return normalized[target]
            for key, value in normalized.items():
                if target in key:
                    return value
        return None

    def _normalize_label(self, value: str) -> str:
        return re.sub(r"\s+", " ", value.lower().replace(":", "")).strip()

    def _tab_url(self, url: str, tab: str) -> str:
        return f"{url}&tab={tab}" if "?" in url else f"{url}?tab={tab}"

    def _dedupe_urls(self, urls: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for url in urls:
            clean_url = clean_text(url)
            if not clean_url or clean_url in seen:
                continue
            seen.add(clean_url)
            result.append(clean_url)
        return result

    def _dedupe_documents(self, docs: list[TenderDocument]) -> list[TenderDocument]:
        seen: set[str] = set()
        result: list[TenderDocument] = []
        for doc in docs:
            if not doc.url or doc.url in seen:
                continue
            seen.add(doc.url)
            result.append(doc)
        return result

    def _extract_complaints_count(self, body: str) -> int | None:
        value = find_first_regex(body, r"Жалоб[аы]?\s*[:\-]?\s*(\d+)")
        return int(value) if value and value.isdigit() else None

    def _log_page_diagnostics(self, requested_url: str, final_url: str, html: str, page_lots: list[TenderLot]) -> None:
        soup = BeautifulSoup(html, "lxml")
        text = clean_text(soup.get_text(" ", strip=True))
        self.log.info(
            "goszakup_page_diagnostics",
            requested_url=requested_url,
            final_url=final_url,
            html_length=len(html),
            rows=len(soup.select("#search-result tbody tr")),
            parsed_lots=len(page_lots),
            text_sample=text[:500],
        )
