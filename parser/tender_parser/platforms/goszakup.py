import re
from collections.abc import Callable
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

from tender_parser.config import Settings
from tender_parser.matching import SmartMatcher
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import absolute_url, attr_or_empty, clean_text, find_first_regex, first_text, html_text, parse_amount, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class GoszakupPlatform(TenderPlatform):
    name = "goszakup"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        lots: dict[str, TenderLot] = {}
        matcher = self._build_matcher(keywords)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            page = browser.new_page(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0")
            try:
                for keyword in keywords:
                    url = f"{self.settings.goszakup_search_url}?{urlencode({'filter[name]': keyword})}"
                    page.goto(url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                    page.wait_for_timeout(1000)
                    for lot in self._parse_search_page(page, keyword):
                        match_text = str(lot.raw.get("match_text") or lot.title)
                        match = matcher.match(match_text, keyword)
                        if self.settings.strict_keyword_filter and not match.matched:
                            continue
                        lot.raw.update({
                            "matched_keyword": match.keyword or keyword,
                            "match_score": round(match.score, 4),
                            "match_method": match.method,
                            "match_reason": match.reason,
                        })
                        if is_seen and self.settings.stop_at_first_seen_lot and is_seen(lot.stable_id):
                            break
                        lots[lot.stable_id] = lot
            finally:
                browser.close()
        return list(lots.values())

    def enrich(self, lot: TenderLot) -> TenderLot:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            page = browser.new_page(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0")
            try:
                page.goto(lot.url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                page.wait_for_timeout(1000)
                fields = self._table_fields(page)
                body = html_text(page.content())
                lot.description = (
                    self._first_field(fields, ["Дополнительная характеристика", "Краткая характеристика", "Наименование ТРУ", "Описание"])
                    or first_text(page, ["#lot_description", ".lot-description", "td:has-text('Описание') + td"])
                    or lot.description
                )
                lot.place = self._first_field(fields, ["Место поставки товара, КАТО", "Место поставки", "Место выполнения", "Адрес поставки"]) or lot.place
                lot.customer_name = self._first_field(fields, ["Наименование заказчика", "Заказчик", "Организатор"]) or lot.customer_name
                lot.purchase_type = self._first_field(fields, ["Способ закупки", "Тип закупки"]) or lot.purchase_type
                lot.start_date = parse_datetime(self._first_field(fields, ["Дата начала приема заявок", "Начало приема заявок"])) or lot.start_date
                lot.end_date = parse_datetime(self._first_field(fields, ["Дата окончания приема заявок", "Окончание приема заявок"])) or lot.end_date
                lot.status = (self._first_field(fields, ["Статус лота"]) or lot.status).lower()
                lot.amount = parse_amount(self._first_field(fields, ["Запланированная сумма", "Сумма 1 год"])) or lot.amount
                lot.complaints_count = self._extract_complaints_count(body)
                lot.documents = self._parse_documents(page, lot.url)
                announce_url = lot.raw.get("announce_url") if isinstance(lot.raw, dict) else None
                if announce_url:
                    page.goto(self._tab_url(str(announce_url), "documents"), wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                    page.wait_for_timeout(1000)
                    lot.documents.extend(self._parse_documents(page, str(announce_url)))
                    lot.documents.extend(self._parse_document_modals(page, str(announce_url)))
                    page.goto(self._tab_url(str(announce_url), "protocols"), wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                    page.wait_for_timeout(1000)
                    lot.documents.extend(self._parse_documents(page, str(announce_url)))
                    lot.documents.extend(self._parse_document_modals(page, str(announce_url)))
                lot.documents = self._dedupe_documents(lot.documents)
                lot.raw = {**lot.raw, "detail_text_sample": body[:4000]}
                return lot
            finally:
                browser.close()

    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        if lot.status not in {"completed", "closed", "finished", "итоги"} and not lot.end_date:
            return lot
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            page = browser.new_page(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0")
            try:
                page.goto(lot.url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                text = html_text(page.content())
                winner_bin = find_first_regex(text, r"(?:БИН|ИИН)\s*(?:победителя)?\s*[:№#-]?\s*(\d{12})")
                if winner_bin:
                    lot.winner_bin = winner_bin
                winner_name = find_first_regex(text, r"Победител[ья]\s*[:№#-]?\s*([^\n\r]{4,160})")
                if winner_name:
                    lot.winner_name = winner_name
                return lot
            finally:
                browser.close()

    def _parse_search_page(self, page, keyword: str) -> list[TenderLot]:
        rows = page.locator("#search-result tbody tr")
        lots: list[TenderLot] = []
        row_count = rows.count()
        for i in range(row_count):
            row = rows.nth(i)
            text = clean_text(row.inner_text(timeout=3000))
            if not text or len(text) < 10:
                continue
            lot_id = clean_text(row.locator("td").nth(0).inner_text(timeout=1000)).split("-", 1)[0].strip()
            if not lot_id:
                continue
            lot_link = row.locator("a[href*='/ru/subpriceoffer/index/']").first
            announce_link = row.locator("a[href*='/ru/announce/index/']").first
            href = attr_or_empty(lot_link, "href")
            announce_href = attr_or_empty(announce_link, "href")
            if not href:
                continue
            lot_title = clean_text(lot_link.inner_text(timeout=1000)) or self._extract_title(row, text)
            announce_title = clean_text(announce_link.inner_text(timeout=1000))
            match_text = " ".join([text, lot_title, announce_title])
            cells = row.locator("td")
            amount = parse_amount(clean_text(cells.nth(4).inner_text(timeout=1000))) if cells.count() > 4 else parse_amount(text)
            purchase_type = clean_text(cells.nth(5).inner_text(timeout=1000)) if cells.count() > 5 else None
            status = clean_text(cells.nth(6).inner_text(timeout=1000)).lower() if cells.count() > 6 else "active"
            customer_name = self._field_from_body(text, ["Заказчик"])
            lots.append(TenderLot(
                source=self.name,
                external_id=lot_id,
                url=absolute_url(self.settings.goszakup_base_url, href),
                title=lot_title or announce_title or f"Лот {lot_id}",
                amount=amount,
                customer_name=customer_name,
                purchase_type=purchase_type,
                status=status or "active",
                raw={
                    "platform": self.name,
                    "keyword": keyword,
                    "matched_keyword": keyword,
                    "match_text": match_text[:4000],
                    "row_text": text[:2000],
                    "announce_url": absolute_url(self.settings.goszakup_base_url, announce_href) if announce_href else None,
                },
            ))
        if lots:
            return lots
        return self._parse_links_fallback(page, keyword)

    def _parse_links_fallback(self, page, keyword: str) -> list[TenderLot]:
        lots: list[TenderLot] = []
        links = page.locator("a[href*='/ru/subpriceoffer/index/']")
        for i in range(min(links.count(), 50)):
            link = links.nth(i)
            href = attr_or_empty(link, "href")
            text = clean_text(link.inner_text(timeout=1500))
            lot_id = self._extract_lot_id(text, href)
            if not lot_id:
                continue
            lots.append(TenderLot(
                source=self.name,
                external_id=lot_id,
                url=absolute_url(self.settings.goszakup_base_url, href),
                title=text or f"Лот {lot_id}",
                raw={"platform": self.name, "keyword": keyword, "matched_keyword": keyword, "match_text": text[:4000]},
            ))
        return lots

    def _build_matcher(self, keywords: list[str]) -> SmartMatcher:
        return SmartMatcher(
            keywords,
            use_morphology=self.settings.smart_match_enabled and self.settings.smart_match_use_morphology,
            semantic_enabled=self.settings.smart_match_enabled and self.settings.semantic_match_enabled,
            semantic_model_name=self.settings.semantic_model_name,
            semantic_threshold=self.settings.semantic_match_threshold,
            min_score=self.settings.min_keyword_score,
        )

    def _extract_lot_id(self, text: str, href: str) -> str | None:
        subprice_match = re.search(r"/subpriceoffer/index/\d+/(\d+)", href or "", re.IGNORECASE)
        if subprice_match:
            return subprice_match.group(1)
        for value in (href, text):
            match = re.search(r"(?:lot[_/-]?|lots[/=]|id[=/])?(\d{5,})", value or "", re.IGNORECASE)
            if match:
                return match.group(1)
        return None

    def _extract_title(self, row, fallback: str) -> str:
        links = row.locator("a")
        for i in range(links.count()):
            text = clean_text(links.nth(i).inner_text(timeout=1000))
            if len(text) > 8 and not text.isdigit():
                return text
        parts = [part for part in re.split(r"\s{2,}|\|", fallback) if len(part.strip()) > 8]
        return clean_text(parts[0]) if parts else fallback[:200]

    def _parse_documents(self, page, lot_url: str) -> list[TenderDocument]:
        docs: list[TenderDocument] = []
        links = page.locator(
            "a[href$='.pdf'], a[href$='.docx'], a[href$='.doc'], "
            "a[href*='download'], a[href*='file'], a[href*='attachment'], "
            "a:has-text('Скачать')"
        )
        for i in range(min(links.count(), 80)):
            link = links.nth(i)
            href = attr_or_empty(link, "href")
            if not href:
                continue
            name = clean_text(link.inner_text(timeout=1000)) or href.rsplit("/", 1)[-1]
            lowered = f"{name} {href}".lower()
            if not any(marker in lowered for marker in ("тех", "специф", "тз", "протокол", "итог", ".pdf", ".doc", ".docx")):
                continue
            docs.append(TenderDocument(name=name, url=absolute_url(lot_url, href)))
        return docs

    def _parse_document_modals(self, page, announce_url: str) -> list[TenderDocument]:
        docs: list[TenderDocument] = []
        rows = page.locator("table tr")
        for i in range(rows.count()):
            row = rows.nth(i)
            row_text = clean_text(row.inner_text(timeout=1000))
            if not any(marker in row_text.lower() for marker in ("тех", "специф", "тз", "протокол", "итог")):
                continue
            buttons = row.locator("button[onclick*='actionModalShowFiles']")
            for j in range(buttons.count()):
                onclick = attr_or_empty(buttons.nth(j), "onclick")
                match = re.search(r"actionModalShowFiles\((\d+)\s*,\s*(\d+)\)", onclick)
                if not match:
                    continue
                modal_url = absolute_url(self.settings.goszakup_base_url, f"/ru/announce/actionAjaxModalShowFiles/{match.group(1)}/{match.group(2)}")
                try:
                    response = page.request.get(modal_url, timeout=self.settings.request_timeout_seconds * 1000)
                    if not response.ok:
                        continue
                    html = response.text()
                except Exception:
                    continue
                for link_match in re.finditer(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", html, re.IGNORECASE | re.DOTALL):
                    href = link_match.group(1)
                    name = html_text(link_match.group(2)) or row_text
                    lowered = f"{name} {href}".lower()
                    if "подпись" in lowered or "signature" in lowered:
                        continue
                    if not any(marker in lowered for marker in ("тех", "специф", "тз", "протокол", "итог", ".pdf", ".doc", ".docx")):
                        continue
                    docs.append(TenderDocument(name=name, url=absolute_url(announce_url, href)))
        return docs

    def _table_fields(self, page) -> dict[str, str]:
        fields: dict[str, str] = {}
        rows = page.locator("table tr")
        for i in range(rows.count()):
            cells = rows.nth(i).locator("th, td")
            if cells.count() < 2:
                continue
            label = clean_text(cells.nth(0).inner_text(timeout=1000))
            value = clean_text(" ".join(cells.nth(j).inner_text(timeout=1000) for j in range(1, cells.count())))
            if label and value and label.lower() not in {"наименование документа", "признак"}:
                fields[label] = value
        return fields

    def _first_field(self, fields: dict[str, str], labels: list[str]) -> str | None:
        for label in labels:
            value = fields.get(label)
            if value:
                return value
        return None

    def _tab_url(self, url: str, tab: str) -> str:
        return f"{url}&tab={tab}" if "?" in url else f"{url}?tab={tab}"

    def _dedupe_documents(self, docs: list[TenderDocument]) -> list[TenderDocument]:
        seen: set[str] = set()
        result: list[TenderDocument] = []
        for doc in docs:
            if doc.url in seen:
                continue
            seen.add(doc.url)
            result.append(doc)
        return result

    def _field_from_body(self, body: str, labels: list[str]) -> str | None:
        for label in labels:
            pattern = rf"{re.escape(label)}\s*[:\-]?\s*([^\n\r]{{3,220}})"
            value = find_first_regex(body, pattern)
            if value:
                return clean_text(value)
        return None

    def _extract_complaints_count(self, body: str) -> int | None:
        value = find_first_regex(body, r"Жалоб[аы]?\s*[:\-]?\s*(\d+)")
        return int(value) if value and value.isdigit() else None
