import re
from collections.abc import Callable
from urllib.parse import urlencode

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from tender_parser.config import Settings
from tender_parser.matching import SmartMatcher
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import absolute_url, attr_or_empty, clean_text, find_first_regex, html_text, parse_amount, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class ZakupPlatform(TenderPlatform):
    name = "zakup"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        lots: dict[str, TenderLot] = {}
        matcher = self._build_matcher(keywords)
        stop_all = False
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            context = browser.new_context(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0", viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            try:
                for page_index in range(self.settings.zakup_lots_max_pages):
                    if stop_all:
                        break
                    url = self._lots_url(page_index)
                    page.goto(url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                    self._wait_quiet(page)
                    page_lots = self._parse_html(page.content(), page.url)
                    if not page_lots:
                        break
                    for lot in page_lots:
                        if is_seen and self.settings.stop_at_first_seen_lot and is_seen(lot.stable_id):
                            stop_all = True
                            break
                        match_text = str(lot.raw.get("match_text") or lot.title)
                        match = matcher.match(match_text)
                        if self.settings.strict_keyword_filter and not match.matched:
                            continue
                        lot.raw.update({
                            "matched_keyword": match.keyword,
                            "match_score": round(match.score, 4),
                            "match_method": match.method,
                            "match_reason": match.reason,
                        })
                        lots[lot.stable_id] = lot
            finally:
                context.close()
                browser.close()
        return list(lots.values())

    def enrich(self, lot: TenderLot) -> TenderLot:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            context = browser.new_context(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0", viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            try:
                page.goto(lot.url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                self._wait_quiet(page)
                body = html_text(page.content())
                lot.documents = self._dedupe_documents([*lot.documents, *self._parse_documents(page, lot.url)])
                lot.complaints_count = self._extract_complaints_count(body) or lot.complaints_count
                lot.raw = {**lot.raw, "detail_text_sample": body[:4000]}
                return lot
            finally:
                context.close()
                browser.close()

    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        if lot.status.lower() not in {"completed", "closed", "finished", "итоги", "завершено", "завершен"} and not lot.end_date:
            return lot
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless)
            context = browser.new_context(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0", viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            try:
                page.goto(lot.url, wait_until="domcontentloaded", timeout=self.settings.request_timeout_seconds * 1000)
                self._wait_quiet(page)
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

    def _lots_url(self, page_index: int) -> str:
        params = {
            "limit": self.settings.zakup_lots_limit,
            "offset": page_index * self.settings.zakup_lots_limit,
            "ord": "undefined",
            "system_id__in": self.settings.zakup_lots_system_ids,
        }
        return f"{self.settings.zakup_lots_url}?{urlencode(params)}"

    def _parse_html(self, html: str, page_url: str) -> list[TenderLot]:
        soup = BeautifulSoup(html, "lxml")
        cards = [card for card in soup.select(".ant-card") if self._field(card, "Номер лота")]
        lots: list[TenderLot] = []
        for card in cards:
            lot = self._card_to_lot(card, page_url)
            if lot:
                lots.append(lot)
        return lots

    def _card_to_lot(self, card, page_url: str) -> TenderLot | None:
        lot_number = self._field(card, "Номер лота")
        external_id = self._lot_id(lot_number)
        if not external_id:
            return None
        plan = self._plan_fields(card)
        tags = [clean_text(tag.get_text(" ", strip=True)) for tag in card.select(".ant-tag")]
        card_text = clean_text(card.get_text(" ", strip=True))
        title = plan.get("Наименование") or plan.get("Дополнительная характеристика") or self._title_from_text(card_text, external_id)
        status = self._field(card, "Статус лота") or (tags[0] if tags else "active")
        purchase_type = tags[1] if len(tags) > 1 else None
        place = self._empty_to_none(self._field(card, "Место поставки"))
        amount = parse_amount(plan.get("Сумма за год") or plan.get("Плановая сумма") or self._first_amount(card_text))
        start_date = self._date_from_card(card, [
            "Дата начала приема заявок",
            "Дата начала приема ценовых предложений",
            "Начало приема заявок",
            "Начало приема ценовых предложений",
            "Дата публикации",
            "Дата объявления",
            "Дата начала",
        ]) or self._date_from_text(card_text, [
            "Дата начала приема заявок",
            "Дата начала приема ценовых предложений",
            "Начало приема заявок",
            "Начало приема ценовых предложений",
            "Дата публикации",
            "Дата объявления",
            "Дата начала",
        ])
        end_date = self._date_from_card(card, [
            "Дата окончания приема заявок",
            "Дата окончания приема ценовых предложений",
            "Окончание приема заявок",
            "Окончание приема ценовых предложений",
            "Срок окончания приема заявок",
            "Срок окончания приема ценовых предложений",
            "Дата окончания",
            "Срок подачи",
        ]) or self._date_from_text(card_text, [
            "Дата окончания приема заявок",
            "Дата окончания приема ценовых предложений",
            "Окончание приема заявок",
            "Окончание приема ценовых предложений",
            "Срок окончания приема заявок",
            "Срок окончания приема ценовых предложений",
            "Дата окончания",
            "Срок подачи",
        ])
        match_text = " ".join(part for part in [title, plan.get("Дополнительная характеристика"), card_text] if part)
        return TenderLot(
            source=self.name,
            external_id=external_id,
            url=page_url,
            title=title or f"Лот {external_id}",
            description=plan.get("Дополнительная характеристика", ""),
            amount=amount,
            start_date=start_date,
            end_date=end_date,
            place=place,
            purchase_type=purchase_type,
            status=status[:64] if status else "active",
            raw={
                "platform": self.name,
                "source_mode": "browser",
                "lot_number": lot_number,
                "plan_point_id": plan.get("Номер пункта плана"),
                "subject_type": tags[2] if len(tags) > 2 else None,
                "status_raw": status,
                "match_text": match_text[:4000],
                "card_text": card_text[:2500],
            },
        )

    def _field(self, card, label: str) -> str:
        for item in card.select(".ant-descriptions-item"):
            label_node = item.select_one(".ant-descriptions-item-label")
            value_node = item.select_one(".ant-descriptions-item-content")
            if clean_text(label_node.get_text(" ", strip=True) if label_node else "") == label:
                return clean_text(value_node.get_text(" ", strip=True) if value_node else "")
        return ""

    def _field_by_labels(self, card, labels: list[str]) -> str:
        expected = [self._normalize_label(label) for label in labels]
        for item in card.select(".ant-descriptions-item"):
            label_node = item.select_one(".ant-descriptions-item-label")
            value_node = item.select_one(".ant-descriptions-item-content")
            label_text = self._normalize_label(label_node.get_text(" ", strip=True) if label_node else "")
            if any(label_text == label or label in label_text for label in expected):
                return clean_text(value_node.get_text(" ", strip=True) if value_node else "")
        return ""

    def _date_from_card(self, card, labels: list[str]):
        return parse_datetime(self._extract_datetime(self._field_by_labels(card, labels)))

    def _date_from_text(self, text: str, markers: list[str]):
        for marker in markers:
            pattern = rf"{re.escape(marker)}[^0-9]{{0,100}}({self._datetime_pattern()})"
            value = find_first_regex(text, pattern)
            parsed = parse_datetime(value)
            if parsed:
                return parsed
        return None

    def _extract_datetime(self, value: str) -> str:
        match = re.search(self._datetime_pattern(), value or "")
        return match.group(0) if match else value

    def _datetime_pattern(self) -> str:
        return r"\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?"

    def _normalize_label(self, value: str) -> str:
        return re.sub(r"\s+", " ", clean_text(value).lower().replace("ё", "е")).strip(" :")

    def _plan_fields(self, card) -> dict[str, str]:
        rows = card.select("tr.ant-table-row")
        if not rows:
            return {}
        cells = [clean_text(cell.get_text(" ", strip=True)) for cell in rows[0].select("td")]
        labels = ["Номер пункта плана", "Наименование", "Дополнительная характеристика", "Цена за ед.", "Кол-во", "Ед. изм.", "Плановая сумма", "Сумма за год"]
        return {label: value for label, value in zip(labels, cells, strict=False) if value}

    def _parse_documents(self, page, lot_url: str) -> list[TenderDocument]:
        docs: list[TenderDocument] = []
        links = page.locator("a[href]")
        for i in range(min(links.count(), 120)):
            link = links.nth(i)
            href = attr_or_empty(link, "href")
            if not href:
                continue
            name = clean_text(link.inner_text(timeout=1000)) or href.rsplit("/", 1)[-1]
            lowered = f"{name} {href}".lower()
            if any(skip in lowered for skip in ("подпись", "signature")):
                continue
            if not any(marker in lowered for marker in ("тех", "специф", "тз", "протокол", "итог", ".pdf", ".doc", ".docx", "download", "file")):
                continue
            docs.append(TenderDocument(name=name, url=absolute_url(lot_url, href)))
        return docs

    def _build_matcher(self, keywords: list[str]) -> SmartMatcher:
        return SmartMatcher(
            keywords,
            use_morphology=self.settings.smart_match_enabled and self.settings.smart_match_use_morphology,
            semantic_enabled=self.settings.smart_match_enabled and self.settings.semantic_match_enabled,
            semantic_model_name=self.settings.semantic_model_name,
            semantic_threshold=self.settings.semantic_match_threshold,
            min_score=self.settings.min_keyword_score,
        )

    def _wait_quiet(self, page) -> None:
        try:
            page.wait_for_load_state("networkidle", timeout=min(self.settings.request_timeout_seconds * 1000, 15000))
        except Exception:
            pass
        page.wait_for_timeout(1500)

    def _lot_id(self, value: str) -> str | None:
        match = re.search(r"(\d{4,})", value or "")
        return match.group(1) if match else None

    def _first_amount(self, value: str) -> str:
        match = re.search(r"[\d\s,.]+\s*₸", value or "")
        return match.group(0) if match else ""

    def _title_from_text(self, text: str, lot_id: str) -> str:
        parts = [part.strip(" :-—") for part in re.split(r"\s{2,}|\||;|(?=Номер лота)|(?=Место поставки)|(?=Статус лота)", text)]
        for part in parts:
            lowered = part.lower()
            if len(part) > 12 and lot_id not in part and not any(marker in lowered for marker in ("опубликован", "номер лота", "место поставки", "статус лота", "бин", "наименование заказчика")):
                return part[:240]
        return f"Лот {lot_id}"

    def _empty_to_none(self, value: str) -> str | None:
        cleaned = clean_text(value)
        if not cleaned or cleaned.lower().replace(",", "").strip() == "undefined undefined":
            return None
        return cleaned

    def _extract_complaints_count(self, body: str) -> int | None:
        value = find_first_regex(body, r"Жалоб[аы]?\s*[:\-]?\s*(\d+)")
        return int(value) if value and value.isdigit() else None

    def _dedupe_documents(self, docs: list[TenderDocument]) -> list[TenderDocument]:
        seen: set[str] = set()
        result: list[TenderDocument] = []
        for doc in docs:
            if doc.url in seen:
                continue
            seen.add(doc.url)
            result.append(doc)
        return result
