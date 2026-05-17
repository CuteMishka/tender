import re
from collections.abc import Callable
from datetime import datetime
from urllib.parse import urlencode, urljoin

import structlog
from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from tender_parser.config import Settings
from tender_parser.matching import SmartMatcher
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import absolute_url, attr_or_empty, clean_text, find_first_regex, html_text, parse_amount, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class ZakupPlatform(TenderPlatform):
    name = "zakup"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.log = structlog.get_logger("tender_parser.zakup")

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        lots: dict[str, TenderLot] = {}
        matcher = self._build_matcher(keywords)
        stop_all = False
        seen_page_signatures: set[tuple[str, ...]] = set()
        chromium_args = self._chromium_args()
        self.log.info("zakup_chromium_configured", chromium_args=chromium_args)
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=self.settings.headless,
                args=chromium_args,
            )
            context = browser.new_context(
                locale="ru-RU",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                viewport={"width": 1440, "height": 1000},
                extra_http_headers={"Accept-Language": "ru-RU,ru;q=0.9,kk;q=0.8,en;q=0.7"},
            )
            self._block_heavy_resources(context)
            page = context.new_page()
            try:
                page_index = 0
                url = self._lots_url(0)
                self._goto(page, url)
                self._wait_lots_ready(page)
                self._set_page_size(page)
                while self.settings.zakup_lots_max_pages == 0 or page_index < self.settings.zakup_lots_max_pages:
                    if stop_all:
                        break
                    page_index += 1
                    self._wait_lots_ready(page)
                    html = page.content()
                    page_lots = self._parse_html(html, page.url)
                    if not page_lots:
                        self._log_page_diagnostics(url, page.url, html, page_lots)
                        break
                    page_signature = tuple(lot.stable_id for lot in page_lots)
                    if page_signature in seen_page_signatures:
                        self._log_page_diagnostics(url, page.url, html, page_lots)
                        self.log.info("zakup_repeated_page_detected", requested_url=page.url, parsed_lots=len(page_lots))
                        break
                    seen_page_signatures.add(page_signature)
                    new_on_page = 0
                    for lot in page_lots:
                        if is_seen and self.settings.stop_at_first_seen_lot and is_seen(lot.stable_id):
                            stop_all = True
                            break
                        if not self._is_active_lot(lot):
                            continue
                        match_text = str(lot.raw.get("match_text") or lot.title)
                        match = matcher.match(match_text)
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
                            new_on_page += 1
                        lots[lot.stable_id] = lot
                    if new_on_page == 0:
                        self.log.info("zakup_no_new_lots_on_page", requested_url=page.url, parsed_lots=len(page_lots))
                        break
                    if self.settings.zakup_lots_max_pages > 0 and page_index >= self.settings.zakup_lots_max_pages:
                        break
                    if not self._go_next_page(page):
                        break
            finally:
                context.close()
                browser.close()
        return list(lots.values())

    def enrich(self, lot: TenderLot) -> TenderLot:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.settings.headless, args=self._chromium_args())
            context = browser.new_context(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0", viewport={"width": 1440, "height": 1000})
            self._block_heavy_resources(context)
            page = context.new_page()
            try:
                self._goto(page, lot.url)
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
            browser = p.chromium.launch(headless=self.settings.headless, args=self._chromium_args())
            context = browser.new_context(locale="ru-RU", user_agent="TenderMachineV2Parser/1.0", viewport={"width": 1440, "height": 1000})
            self._block_heavy_resources(context)
            page = context.new_page()
            try:
                self._goto(page, lot.url)
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
            "system_id__in": self.settings.zakup_lots_system_ids,
        }
        return f"{self.settings.zakup_lots_url}?{urlencode(params)}"

    def _chromium_args(self) -> list[str]:
        args = [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=AsyncDns",
        ]
        resolver_ip = (self.settings.zakup_host_resolver_ip or "").strip()
        if resolver_ip:
            args.append(f"--host-resolver-rules=MAP zakup.gov.kz {resolver_ip},EXCLUDE localhost")
        return args

    def _block_heavy_resources(self, context) -> None:
        def handle(route) -> None:
            if route.request.resource_type in {"image", "font", "media"}:
                route.abort()
                return
            route.continue_()

        context.route("**/*", handle)

    def _goto(self, page, url: str):
        response = page.goto(url, wait_until="commit", timeout=self.settings.request_timeout_seconds * 1000)
        self.log.info(
            "zakup_navigation_committed",
            requested_url=url,
            final_url=page.url,
            status=response.status if response else None,
        )
        return response

    def _is_active_lot(self, lot: TenderLot) -> bool:
        if lot.end_date and lot.end_date < datetime.now():
            return False
        status_text = f"{lot.status} {lot.raw.get('status_raw') or ''}".lower()
        inactive_markers = ("заверш", "итог", "отмен", "cancel", "complete", "finish", "closed")
        return not any(marker in status_text for marker in inactive_markers)

    def _parse_html(self, html: str, page_url: str) -> list[TenderLot]:
        soup = BeautifulSoup(html, "lxml")
        cards = [card for card in soup.select(".ant-card") if self._lot_id(self._field(card, "Номер лота"))]
        if not cards:
            cards = self._lot_cards_from_text(soup)
        lots: dict[str, TenderLot] = {}
        for card in cards:
            lot = self._card_to_lot(card, page_url)
            if lot:
                lots[lot.stable_id] = lot
        return list(lots.values())

    def _lot_cards_from_text(self, soup: BeautifulSoup) -> list:
        cards = []
        seen: set[int] = set()
        for node in soup.find_all(string=re.compile(r"Номер\s+лота", re.IGNORECASE)):
            parent = node.parent
            for _ in range(10):
                if parent is None or not getattr(parent, "name", None):
                    break
                text = clean_text(parent.get_text(" ", strip=True))
                if len(text) > 100 and self._lot_id(self._extract_labeled_text(text, ["Номер лота"])):
                    marker = id(parent)
                    if marker not in seen:
                        seen.add(marker)
                        cards.append(parent)
                    break
                parent = parent.parent
        return cards

    def _log_page_diagnostics(self, requested_url: str, final_url: str, html: str, page_lots: list[TenderLot]) -> None:
        soup = BeautifulSoup(html, "lxml")
        text = clean_text(soup.get_text(" ", strip=True))
        self.log.info(
            "zakup_page_diagnostics",
            requested_url=requested_url,
            final_url=final_url,
            html_length=len(html),
            ant_cards=len(soup.select(".ant-card")),
            has_lot_number="Номер лота" in text,
            parsed_lots=len(page_lots),
            card_samples=[clean_text(card.get_text(" ", strip=True))[:300] for card in soup.select(".ant-card")[:2]],
            text_sample=text[:500],
        )

    def _card_to_lot(self, card, page_url: str) -> TenderLot | None:
        lot_number = self._field(card, "Номер лота")
        external_id = self._lot_id(lot_number)
        if not external_id:
            return None
        plan = self._plan_fields(card)
        tags = [clean_text(tag.get_text(" ", strip=True)) for tag in card.select(".ant-tag")]
        card_text = clean_text(card.get_text(" ", strip=True))
        title = plan.get("Наименование") or plan.get("Дополнительная характеристика") or self._title_from_text(card_text, external_id)
        status = self._field(card, "Статус лота") or self._status_from_card_text(card_text) or (tags[0] if tags else "active")
        purchase_type = tags[1] if len(tags) > 1 else None
        place = self._empty_to_none(self._field(card, "Место поставки"))
        customer_name = self._empty_to_none(self._field(card, "Заказчик"))
        amount = parse_amount(plan.get("Сумма за год") or plan.get("Плановая сумма") or self._first_amount(card_text))
        application_start, application_end = self._application_dates_from_text(card_text)
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
        ]) or application_start
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
        ]) or application_end
        match_text = " ".join(part for part in [title, plan.get("Дополнительная характеристика"), card_text] if part)
        return TenderLot(
            source=self.name,
            external_id=external_id,
            url=self._lot_url(external_id),
            title=title or f"Лот {external_id}",
            description=plan.get("Дополнительная характеристика", ""),
            amount=amount,
            start_date=start_date,
            end_date=end_date,
            place=place,
            customer_name=customer_name,
            organizer_name=customer_name,
            purchase_type=purchase_type,
            status=status[:64] if status else "active",
            raw={
                "platform": self.name,
                "source_mode": "browser",
                "lot_number": lot_number,
                "plan_point_id": plan.get("Номер пункта плана"),
                "subject_type": tags[2] if len(tags) > 2 else None,
                "status_raw": status,
                "applications_start": application_start.isoformat() if application_start else None,
                "applications_end": application_end.isoformat() if application_end else None,
                "match_text": match_text[:4000],
                "card_text": card_text[:2500],
            },
        )

    def _field(self, card, label: str) -> str:
        expected = self._normalize_label(label)
        for item in card.select(".ant-descriptions-item"):
            label_node = item.select_one(".ant-descriptions-item-label")
            value_node = item.select_one(".ant-descriptions-item-content")
            label_text = self._normalize_label(label_node.get_text(" ", strip=True) if label_node else "")
            if label_text == expected or expected in label_text:
                return clean_text(value_node.get_text(" ", strip=True) if value_node else "")
        return self._extract_labeled_text(clean_text(card.get_text(" ", strip=True)), [label])

    def _lot_url(self, lot_id: str) -> str:
        return urljoin(self.settings.zakup_public_base_url, f"/?lotId={lot_id}")

    def _field_by_labels(self, card, labels: list[str]) -> str:
        expected = [self._normalize_label(label) for label in labels]
        for item in card.select(".ant-descriptions-item"):
            label_node = item.select_one(".ant-descriptions-item-label")
            value_node = item.select_one(".ant-descriptions-item-content")
            label_text = self._normalize_label(label_node.get_text(" ", strip=True) if label_node else "")
            if any(label_text == label or label in label_text for label in expected):
                return clean_text(value_node.get_text(" ", strip=True) if value_node else "")
        return self._extract_labeled_text(clean_text(card.get_text(" ", strip=True)), labels)

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

    def _application_dates_from_text(self, text: str) -> tuple[datetime | None, datetime | None]:
        pattern = rf"Заявки\s+принимаются\s*:?\s*({self._datetime_pattern()})\s*[-–—]\s*({self._datetime_pattern()})"
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            return None, None
        return parse_datetime(match.group(1)), parse_datetime(match.group(2))

    def _status_from_card_text(self, text: str) -> str:
        for status in ("Опубликован", "Прием заявок", "Завершен", "Завершён", "Отменен", "Отменён"):
            if re.search(rf"\b{re.escape(status)}\b", text, re.IGNORECASE):
                return status
        return ""

    def _extract_datetime(self, value: str) -> str:
        match = re.search(self._datetime_pattern(), value or "")
        return match.group(0) if match else value

    def _datetime_pattern(self) -> str:
        return r"\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?"

    def _normalize_label(self, value: str) -> str:
        return re.sub(r"\s+", " ", clean_text(value).lower().replace("ё", "е")).strip(" :")

    def _extract_labeled_text(self, text: str, labels: list[str]) -> str:
        if not text:
            return ""
        known_labels = [
            "Номер лота",
            "Статус лота",
            "Место поставки",
            "Заказчик",
            "Заявки принимаются",
            "Опубликован",
            "Объявление",
            "Номер пункта плана",
            "Наименование",
            "Дополнительная характеристика",
            "Цена за ед.",
            "Кол-во",
            "Ед. изм.",
            "Плановая сумма",
            "Сумма за год",
            "Дата начала приема заявок",
            "Дата начала приема ценовых предложений",
            "Начало приема заявок",
            "Начало приема ценовых предложений",
            "Дата публикации",
            "Дата объявления",
            "Дата начала",
            "Дата окончания приема заявок",
            "Дата окончания приема ценовых предложений",
            "Окончание приема заявок",
            "Окончание приема ценовых предложений",
            "Срок окончания приема заявок",
            "Срок окончания приема ценовых предложений",
            "Дата окончания",
            "Срок подачи",
        ]
        next_label = "|".join(re.escape(item) for item in known_labels)
        for label in labels:
            if self._normalize_label(label) == "номер лота":
                lot_id = find_first_regex(text, r"Номер\s+лота\s*:?\s*(\d{4,})")
                if lot_id:
                    return lot_id
            pattern = rf"{re.escape(label)}\s*:?\s*(.+?)(?=\s+(?:{next_label})\s*:?\s+|$)"
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return clean_text(match.group(1))
        return ""

    def _plan_fields(self, card) -> dict[str, str]:
        rows = card.select("tr.ant-table-row")
        labels = ["Номер пункта плана", "Наименование", "Дополнительная характеристика", "Цена за ед.", "Кол-во", "Ед. изм.", "Плановая сумма", "Сумма за год"]
        if not rows:
            card_text = clean_text(card.get_text(" ", strip=True))
            return {label: self._extract_labeled_text(card_text, [label]) for label in labels if self._extract_labeled_text(card_text, [label])}
        cells = [clean_text(cell.get_text(" ", strip=True)) for cell in rows[0].select("td")]
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

    def _wait_lots_ready(self, page) -> None:
        self._wait_quiet(page)
        timeout = min(self.settings.request_timeout_seconds * 1000, 45000)
        try:
            page.wait_for_selector("text=Номер лота", timeout=timeout)
        except PlaywrightTimeoutError:
            self.log.warning("zakup_lots_text_timeout", url=page.url, timeout_ms=timeout)
        page.wait_for_timeout(1000)

    def _set_page_size(self, page) -> None:
        wanted = str(self.settings.zakup_lots_limit)
        try:
            selector = page.locator(".ant-pagination-options .ant-select-selector").last
            if not selector.count():
                return
            current = clean_text(selector.inner_text(timeout=1000))
            if wanted in current:
                return
            selector.click(timeout=3000)
            option = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter(has_text=wanted).last
            if not option.count():
                return
            option.click(timeout=3000)
            self._wait_quiet(page)
            self.log.info("zakup_page_size_selected", page_size=self.settings.zakup_lots_limit)
        except Exception as exc:
            self.log.warning("zakup_page_size_select_failed", page_size=self.settings.zakup_lots_limit, error=str(exc))

    def _go_next_page(self, page) -> bool:
        try:
            item = page.locator("li.ant-pagination-next").first
            if not item.count():
                self.log.info("zakup_next_page_missing")
                return False
            class_name = item.get_attribute("class") or ""
            if "ant-pagination-disabled" in class_name:
                self.log.info("zakup_next_page_disabled")
                return False
            control = page.locator("li.ant-pagination-next:not(.ant-pagination-disabled) button, li.ant-pagination-next:not(.ant-pagination-disabled) a").first
            if not control.count():
                self.log.info("zakup_next_page_control_missing")
                return False
            control.click(timeout=5000)
            self._wait_quiet(page)
            self.log.info("zakup_next_page_clicked", url=page.url)
            return True
        except Exception as exc:
            self.log.warning("zakup_next_page_failed", error=str(exc))
            return False

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
