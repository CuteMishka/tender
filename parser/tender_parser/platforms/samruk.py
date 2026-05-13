import re
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import absolute_url, attr_or_empty, clean_text, find_first_regex, html_text, parse_amount, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class SamrukPlatform(TenderPlatform):
    name = "samruk"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, keywords: list[str]) -> list[TenderLot]:
        lots: dict[str, TenderLot] = {}
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            page = browser.new_page(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0")
            try:
                for keyword in keywords:
                    url = f"{self.settings.samruk_search_url}?{urlencode({'q': keyword})}"
                    page.goto(url, wait_until="networkidle", timeout=self.settings.request_timeout_seconds * 1000)
                    page.wait_for_timeout(2500)
                    for lot in self._parse_cards(page, keyword):
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
                page.wait_for_timeout(2000)
                text = html_text(page.content())
                lot.description = self._field(text, ["Описание", "Наименование", "Предмет закупки"]) or lot.description
                lot.place = self._field(text, ["Место поставки", "Регион", "Адрес"]) or lot.place
                lot.customer_name = self._field(text, ["Заказчик", "Организатор"]) or lot.customer_name
                lot.purchase_type = self._field(text, ["Способ закупки", "Тип закупки"]) or lot.purchase_type
                lot.start_date = parse_datetime(self._field(text, ["Начало приема", "Дата начала"])) or lot.start_date
                lot.end_date = parse_datetime(self._field(text, ["Окончание приема", "Дата окончания", "Срок окончания"])) or lot.end_date
                lot.documents = self._parse_documents(page, lot.url)
                lot.raw = {**lot.raw, "detail_text_sample": text[:4000]}
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
                page.wait_for_timeout(1500)
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

    def _parse_cards(self, page, keyword: str) -> list[TenderLot]:
        candidates = page.locator("a[href*='purchase'], a[href*='tender'], a[href*='lot'], a[href*='result']")
        lots: list[TenderLot] = []
        seen: set[str] = set()
        for i in range(min(candidates.count(), 100)):
            link = candidates.nth(i)
            href = attr_or_empty(link, "href")
            text = clean_text(link.inner_text(timeout=1500))
            lot_id = self._extract_id(href, text)
            if not lot_id or lot_id in seen:
                continue
            seen.add(lot_id)
            container_text = self._container_text(link) or text
            lots.append(TenderLot(
                source=self.name,
                external_id=lot_id,
                url=absolute_url(self.settings.samruk_search_url, href),
                title=text or self._title_from_text(container_text, lot_id),
                amount=parse_amount(container_text),
                raw={"keyword": keyword, "card_text": container_text[:2000]},
            ))
        return lots

    def _parse_documents(self, page, lot_url: str) -> list[TenderDocument]:
        docs: list[TenderDocument] = []
        links = page.locator("a[href$='.pdf'], a[href$='.docx'], a[href$='.doc'], a:has-text('Скачать'), a:has-text('Техничес'), a:has-text('Протокол')")
        for i in range(min(links.count(), 80)):
            link = links.nth(i)
            href = attr_or_empty(link, "href")
            if not href:
                continue
            name = clean_text(link.inner_text(timeout=1000)) or href.rsplit("/", 1)[-1]
            docs.append(TenderDocument(name=name, url=absolute_url(lot_url, href)))
        return docs

    def _extract_id(self, href: str, text: str) -> str | None:
        for value in (href, text):
            match = re.search(r"(\d{5,})", value or "")
            if match:
                return match.group(1)
        return None

    def _container_text(self, link) -> str:
        for selector in ["xpath=ancestor::*[self::div or self::tr or self::article][1]", "xpath=ancestor::*[self::div][2]"]:
            try:
                text = clean_text(link.locator(selector).inner_text(timeout=1000))
                if text:
                    return text
            except Exception:
                pass
        return ""

    def _title_from_text(self, text: str, lot_id: str) -> str:
        for part in re.split(r"\s{2,}|\n|\|", text):
            part = clean_text(part)
            if len(part) > 12 and lot_id not in part:
                return part
        return f"Лот {lot_id}"

    def _field(self, body: str, labels: list[str]) -> str | None:
        for label in labels:
            value = find_first_regex(body, rf"{re.escape(label)}\s*[:\-]?\s*([^\n\r]{{3,220}})")
            if value:
                return clean_text(value)
        return None
