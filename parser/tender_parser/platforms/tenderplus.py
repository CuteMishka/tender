from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import html
import re
from typing import Any, Callable
from urllib.parse import urljoin

import httpx
import structlog

from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import clean_text, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class TenderPlusPlatform(TenderPlatform):
    name = "tenderplus"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.log = structlog.get_logger("tender_parser.tenderplus")

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        token = (self.settings.tenderplus_token or "").strip()
        if not token:
            self.log.warning("tenderplus_token_missing")
            return []

        page_size = self.settings.tenderplus_page_size
        max_pages = self.settings.tenderplus_max_pages
        max_lots = self.settings.tenderplus_max_lots
        end_date_from = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        query_keywords = [] if self.settings.collect_all_active_lots else [k.strip() for k in keywords if k.strip()]
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        lots: dict[str, TenderLot] = {}
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            for page in range(1, max_pages + 1):
                payload = {"query": self._query(query_keywords, page, page_size, end_date_from)}
                response = client.post(self.settings.tenderplus_url, headers=headers, json=payload)
                response.raise_for_status()
                body = response.json()
                errors = body.get("errors")
                if errors:
                    raise RuntimeError(f"tenderplus graphql error: {str(errors)[:500]}")

                rows = ((body.get("data") or {}).get("lot") or [])
                if not isinstance(rows, list) or not rows:
                    break

                added = 0
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    lot = self._lot_from_payload(row)
                    if lot is None or not self._is_active_lot(lot):
                        continue
                    if is_seen and self.settings.stop_at_first_seen_lot and is_seen(lot.stable_id):
                        self.log.info("tenderplus_seen_lot_stop", lot=lot.stable_id)
                        return list(lots.values())[:max_lots]
                    if lot.stable_id not in lots:
                        added += 1
                    lots[lot.stable_id] = lot
                    if len(lots) >= max_lots:
                        break

                self.log.info("tenderplus_page_parsed", page=page, received=len(rows), added=added, total=len(lots))
                if len(rows) < page_size or len(lots) >= max_lots:
                    break

        return list(lots.values())[:max_lots]

    def enrich(self, lot: TenderLot) -> TenderLot:
        return lot

    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        return lot

    def _query(self, keywords: list[str], page: int, limit: int, end_date_from: str) -> str:
        return f"""{{
  lot( pagination: {{ limit: {limit}, page: {page} }} filter: {{ keywords: {self._string_list(keywords)}, endDateFrom: {self._quote(end_date_from)} }} ) {{
    id
    lot
    lot_source_id
    title
    description
    cost
    one_cost
    counts
    ed
    pre_pay
    extra_data
    partnerLink
    place
    buy_id
    documents {{
      name
      downloadLink
    }}
    region {{
      name
    }}
    subjectType {{
      name
    }}
    enstru {{
      code
      title
      description
    }}
    category {{
      name
    }}
    lotBuy {{
      begin_date
      end_date
      pub_date
      buy
      source_id
      title_buy
      organizer
      documents {{
        name
        downloadLink
      }}
      partner {{
        name
      }}
      organization {{
        bin_iin
        short_name
      }}
      tenderTypePartner {{
        name
      }}
      lot_status_id
      lotStatus {{
        name
      }}
    }}
  }}
}}"""

    def _lot_from_payload(self, row: dict[str, Any]) -> TenderLot | None:
        lot_id = self._str_value(row.get("id"))
        if not lot_id:
            return None
        lot_buy = row.get("lotBuy") if isinstance(row.get("lotBuy"), dict) else {}
        region = row.get("region") if isinstance(row.get("region"), dict) else {}
        subject_type = row.get("subjectType") if isinstance(row.get("subjectType"), dict) else {}
        enstru = row.get("enstru") if isinstance(row.get("enstru"), dict) else {}
        category = row.get("category") if isinstance(row.get("category"), dict) else {}
        partner = lot_buy.get("partner") if isinstance(lot_buy.get("partner"), dict) else {}
        organization = lot_buy.get("organization") if isinstance(lot_buy.get("organization"), dict) else {}
        tender_type = lot_buy.get("tenderTypePartner") if isinstance(lot_buy.get("tenderTypePartner"), dict) else {}
        status_obj = lot_buy.get("lotStatus") if isinstance(lot_buy.get("lotStatus"), dict) else {}

        title = clean_text(self._str_value(row.get("title")) or self._str_value(lot_buy.get("title_buy")) or f"TenderPlus lot {lot_id}")
        description = clean_text(self._str_value(row.get("description")) or "")
        subject_name = clean_text(self._str_value(subject_type.get("name")) or "") or None
        enstru_code = clean_text(self._str_value(enstru.get("code")) or "") or None
        enstru_title = clean_text(self._str_value(enstru.get("title")) or "") or None
        enstru_description = clean_text(self._str_value(enstru.get("description")) or "") or None
        category_name = clean_text(self._str_value(category.get("name")) or "") or None
        tender_type_name = clean_text(self._str_value(tender_type.get("name")) or "") or None
        purchase_type = tender_type_name or subject_name or clean_text(self._str_value(lot_buy.get("title_buy")) or title) or None
        published_platform = clean_text(self._str_value(partner.get("name")) or "") or "TenderPlus API"
        customer = clean_text(self._str_value(organization.get("short_name")) or self._str_value(lot_buy.get("organizer")) or "") or None
        region_name = clean_text(self._str_value(region.get("name")) or "") or None
        status = clean_text(self._str_value(status_obj.get("name")) or "active")[:64] or "active"
        start_date = parse_datetime(self._str_value(lot_buy.get("pub_date")) or self._str_value(lot_buy.get("begin_date")))
        end_date = parse_datetime(self._str_value(lot_buy.get("end_date")))
        tenderplus_page_url = f"https://tenderplus.kz/zakupki/{lot_id}"
        available_documents = self._documents(row, lot_buy, tenderplus_page_url)
        documents = available_documents if self.settings.tenderplus_include_documents else []
        match_text = clean_text(
            " ".join(
                part
                for part in [
                    title,
                    description,
                    purchase_type or "",
                    customer or "",
                    region_name or "",
                    subject_name or "",
                    category_name or "",
                    enstru_code or "",
                    enstru_title or "",
                    enstru_description or "",
                    self._str_value(row.get("extra_data")),
                ]
                if part
            )
        )

        raw = {
            "platform": self.name,
            "source_label": published_platform,
            "published_platform": published_platform,
            "source_mode": "api",
            "lot": self._str_value(row.get("lot")),
            "lot_source_id": self._str_value(row.get("lot_source_id")),
            "ed": self._str_value(row.get("ed")),
            "counts": row.get("counts"),
            "one_cost": row.get("one_cost"),
            "pre_pay": self._str_value(row.get("pre_pay")),
            "extra_data": self._str_value(row.get("extra_data")),
            "buy_id": row.get("buy_id"),
            "buy": self._str_value(lot_buy.get("buy")),
            "buy_source_id": self._str_value(lot_buy.get("source_id")),
            "organizer": self._str_value(lot_buy.get("organizer")),
            "organization_bin_iin": self._str_value(organization.get("bin_iin")),
            "organization_name": customer,
            "begin_date": self._str_value(lot_buy.get("begin_date")),
            "end_date": self._str_value(lot_buy.get("end_date")),
            "pub_date": self._str_value(lot_buy.get("pub_date")),
            "region": region_name,
            "partner": published_platform,
            "subject_type": subject_name,
            "category": category_name,
            "enstru_code": enstru_code,
            "enstru_title": enstru_title,
            "enstru_description": enstru_description,
            "tender_type_partner": tender_type_name,
            "documents_available": len(available_documents),
            "documents_skipped": not self.settings.tenderplus_include_documents,
            "documents": [{"name": doc.name, "downloadLink": doc.url} for doc in available_documents],
            "tenderplus_page_url": tenderplus_page_url,
            "match_text": match_text[:4000],
        }

        return TenderLot(
            source=self.name,
            external_id=lot_id,
            url=clean_text(self._str_value(row.get("partnerLink")) or ""),
            title=title,
            description=description,
            amount=self._decimal(row.get("cost")),
            start_date=start_date,
            end_date=end_date,
            place=clean_text(self._str_value(row.get("place")) or "") or region_name,
            customer_name=customer,
            organizer_name=customer,
            purchase_type=purchase_type,
            status=status,
            raw=raw,
            documents=documents,
        )

    def _documents(self, row: dict[str, Any], lot_buy: dict[str, Any], tenderplus_page_url: str) -> list[TenderDocument]:
        docs: list[TenderDocument] = []
        seen: set[str] = set()
        for source in (row.get("documents"), lot_buy.get("documents")):
            if not isinstance(source, list):
                continue
            for item in source:
                if not isinstance(item, dict):
                    continue
                url = clean_text(self._str_value(item.get("downloadLink")) or "")
                if not url or url in seen:
                    continue
                seen.add(url)
                name = clean_text(self._str_value(item.get("name")) or url.rsplit("/", 1)[-1] or "document")
                docs.append(TenderDocument(name=name, url=url))
        docs.extend(self._attached_files_from_page(tenderplus_page_url, seen))
        return docs

    def _attached_files_from_page(self, page_url: str, seen: set[str]) -> list[TenderDocument]:
        try:
            response = httpx.get(
                page_url,
                timeout=self.settings.request_timeout_seconds,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 tender-parser/1.0"},
            )
            response.raise_for_status()
        except Exception as exc:
            self.log.warning("tenderplus_attached_files_fetch_failed", url=page_url, error=str(exc))
            return []

        text = response.text
        lowered = text.lower()
        start = lowered.find("прикреп")
        fragment = text[start : start + 30000] if start >= 0 else text
        docs: list[TenderDocument] = []
        for match in re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", fragment, flags=re.IGNORECASE | re.DOTALL):
            href = html.unescape(match.group(1).strip())
            label_html = match.group(2)
            label = clean_text(re.sub(r"<[^>]+>", " ", html.unescape(label_html)))
            absolute = urljoin(page_url, href)
            if absolute in seen or not self._looks_like_attachment(absolute, label):
                continue
            seen.add(absolute)
            docs.append(TenderDocument(name=label or absolute.rsplit("/", 1)[-1] or "document", url=absolute))
        return docs

    def _looks_like_attachment(self, url: str, label: str) -> bool:
        value = f"{url} {label}".lower()
        return bool(re.search(r"\.(pdf|docx?|xlsx?|zip|rar|7z)(?:[\s?#]|$)", value))

    def _is_active_lot(self, lot: TenderLot) -> bool:
        if lot.end_date and lot.end_date < datetime.utcnow():
            return False
        status = (lot.status or "").lower()
        inactive_markers = ("completed", "closed", "finished", "cancel", "archive", "заверш", "итог", "отмен")
        inactive_markers = (
            *inactive_markers,
            "заверш",
            "итог",
            "отмен",
            "архив",
            "несостоя",
        )
        return not any(marker in status for marker in inactive_markers)

    def _str_value(self, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    def _decimal(self, value: Any) -> Decimal | None:
        if value is None or value == "":
            return None
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None

    def _quote(self, value: str) -> str:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'

    def _string_list(self, values: list[str]) -> str:
        return "[" + ", ".join(self._quote(value.strip()) for value in values if value.strip()) + "]"
