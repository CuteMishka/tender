import re
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import absolute_url, attr_or_empty, clean_text, find_first_regex, first_text, html_text, parse_amount, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class GoszakupPlatform(TenderPlatform):
    name = "goszakup"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, keywords: list[str]) -> list[TenderLot]:
        lots: dict[str, TenderLot] = {}
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            page = browser.new_page(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0")
            try:
                for keyword in keywords:
                    url = f"{self.settings.goszakup_search_url}?{urlencode({'filter[name]': keyword})}"
                    page.goto(url, wait_until="networkidle", timeout=self.settings.request_timeout_seconds * 1000)
                    page.wait_for_timeout(1000)
                    for lot in self._parse_search_page(page, keyword):
                        lots[lot.stable_id] = lot
            finally:
                browser.close()
        return list(lots.values())

    def enrich(self, lot: TenderLot) -> TenderLot:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            page = browser.new_page(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0")
            try:
                page.goto(lot.url, wait_until="networkidle", timeout=self.settings.request_timeout_seconds * 1000)
                page.wait_for_timeout(1000)
                body = html_text(page.content())
                lot.description = first_text(page, ["#lot_description", ".lot-description", "td:has-text('Описание') + td"]) or lot.description
                lot.place = self._field_from_body(body, ["Место поставки", "Место выполнения", "Адрес поставки"]) or lot.place
                lot.customer_name = self._field_from_body(body, ["Заказчик", "Организатор"]) or lot.customer_name
                lot.purchase_type = self._field_from_body(body, ["Способ закупки", "Тип закупки"]) or lot.purchase_type
                lot.start_date = parse_datetime(self._field_from_body(body, ["Начало приема заявок", "Дата начала приема заявок"])) or lot.start_date
                lot.end_date = parse_datetime(self._field_from_body(body, ["Окончание приема заявок", "Дата окончания приема заявок"])) or lot.end_date
                lot.complaints_count = self._extract_complaints_count(body)
                lot.documents = self._parse_documents(page, lot.url)
                announce_url = lot.raw.get("announce_url") if isinstance(lot.raw, dict) else None
                if announce_url:
                    page.goto(str(announce_url), wait_until="networkidle", timeout=self.settings.request_timeout_seconds * 1000)
                    page.wait_for_timeout(1000)
                    lot.documents.extend(self._parse_documents(page, str(announce_url)))
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
                page.goto(lot.url, wait_until="networkidle", timeout=self.settings.request_timeout_seconds * 1000)
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
                raw={"keyword": keyword, "row_text": text[:2000], "announce_url": absolute_url(self.settings.goszakup_base_url, announce_href) if announce_href else None},
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
                raw={"keyword": keyword},
            ))
        return lots

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
