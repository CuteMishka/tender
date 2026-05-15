from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from tender_parser.config import Settings
from tender_parser.matching import SmartMatcher
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.utils import clean_text, parse_datetime
from tender_parser.schemas import TenderDocument, TenderLot


class ZakupOwsPlatform(TenderPlatform):
    name = "zakup"

    _LOTS_QUERY = """
    query($limit: Int, $after: Int, $filter: LotsFiltersInput) {
      Lots(limit: $limit, after: $after, filter: $filter) {
        id
        lotNumber
        refLotStatusId
        lastUpdateDate
        count
        amount
        nameRu
        nameKz
        descriptionRu
        descriptionKz
        customerId
        customerBin
        customerNameRu
        customerNameKz
        trdBuyNumberAnno
        trdBuyId
        dumping
        refTradeMethodsId
        refBuyTradeMethodsId
        psdSign
        consultingServices
        pointList
        enstruList
        plnPointKatoList
        indexDate
        systemId
        RefLotsStatus {
          nameRu
          code
        }
        RefTradeMethods {
          nameRu
          code
        }
        RefBuyTradeMethods {
          nameRu
          code
        }
        TrdBuy {
          id
          numberAnno
          nameRu
          nameKz
          totalSum
          refTradeMethodsId
          customerBin
          customerNameRu
          orgBin
          orgNameRu
          refBuyStatusId
          startDate
          endDate
          publishDate
          lastUpdateDate
          RefTradeMethods {
            nameRu
            code
          }
          Files {
            filePath
            originalName
            nameRu
            nameKz
          }
        }
        Files {
          filePath
          originalName
          nameRu
          nameKz
        }
      }
    }
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        token = (self.settings.goszakup_ows_token or "").strip()
        if not token:
            raise RuntimeError("GOSZAKUP_OWS_TOKEN is required for zakup.gov.kz / OWS v3 parser")
        matcher = self._build_matcher(keywords)
        lots: dict[str, TenderLot] = {}
        with httpx.Client(timeout=self.settings.request_timeout_seconds, follow_redirects=True) as client:
            for keyword in keywords:
                after: int | None = None
                page = 0
                while self.settings.zakup_ows_max_pages_per_keyword == 0 or page < self.settings.zakup_ows_max_pages_per_keyword:
                    page += 1
                    payload = self._fetch_lots(client, token, keyword, after)
                    page_lots = payload.get("lots") or []
                    if not page_lots:
                        break
                    stop_keyword = False
                    for item in page_lots:
                        lot = self._lot_from_payload(item, keyword)
                        if lot is None:
                            continue
                        if is_seen and self.settings.stop_at_first_seen_lot and is_seen(lot.stable_id):
                            stop_keyword = True
                            break
                        match_text = str(lot.raw.get("match_text") or "")
                        match = matcher.match(match_text, keyword)
                        if self.settings.strict_keyword_filter and not match.matched:
                            continue
                        lot.raw.update({
                            "matched_keyword": match.keyword or keyword,
                            "match_score": round(match.score, 4),
                            "match_method": match.method,
                            "match_reason": match.reason,
                        })
                        lots[lot.stable_id] = lot
                    if stop_keyword:
                        break
                    after = self._next_after(payload, page_lots)
                    if not after:
                        break
        return list(lots.values())

    def enrich(self, lot: TenderLot) -> TenderLot:
        return lot

    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        return lot

    def _fetch_lots(self, client: httpx.Client, token: str, keyword: str, after: int | None) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        body = {
            "operationName": None,
            "query": self._LOTS_QUERY,
            "variables": {
                "limit": self.settings.zakup_ows_limit_per_page,
                "after": after,
                "filter": {"nameDescriptionRu": keyword},
            },
        }
        try:
            response = client.post(self.settings.goszakup_ows_graphql_url, headers=headers, json=body)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"OWS v3 GraphQL HTTP {exc.response.status_code}: {exc.response.text[:500]}") from exc
        payload = response.json()
        if payload.get("errors"):
            raise RuntimeError(str(payload.get("errors")[:1]))
        return {
            "lots": ((payload.get("data") or {}).get("Lots") or []),
            "extensions": payload.get("extensions") or {},
        }

    def _lot_from_payload(self, item: dict[str, Any], keyword: str) -> TenderLot | None:
        lot_id = self._str_field(item, "id")
        if not lot_id:
            return None
        buy = item.get("TrdBuy") if isinstance(item.get("TrdBuy"), dict) else {}
        title = self._str_field(item, "nameRu", "name_ru") or self._str_field(buy, "nameRu", "name_ru") or f"Лот {lot_id}"
        description = self._str_field(item, "descriptionRu", "description_ru")
        customer_name = self._str_field(item, "customerNameRu", "customer_name_ru") or self._str_field(buy, "customerNameRu", "customer_name_ru")
        customer_bin = self._str_field(item, "customerBin", "customer_bin") or self._str_field(buy, "customerBin", "customer_bin")
        organizer_name = self._str_field(buy, "orgNameRu", "org_name_ru")
        organizer_bin = self._str_field(buy, "orgBin", "org_bin")
        announcement_number = self._str_field(item, "trdBuyNumberAnno", "trd_buy_number_anno") or self._str_field(buy, "numberAnno", "number_anno")
        buy_title = self._str_field(buy, "nameRu", "name_ru")
        match_text = " ".join(part for part in [title, description, customer_name, organizer_name, buy_title, announcement_number] if part)
        status_id = self._int_field(item, "ref_lot_status_id", "refLotStatusId")
        status_name = self._nested_str(item, "RefLotsStatus", "nameRu") or self._nested_str(item, "RefLotsStatus", "code")
        trade_method_id = self._int_field(item, "ref_buy_trade_methods_id", "refBuyTradeMethodsId") or self._int_field(item, "ref_trade_methods_id", "refTradeMethodsId")
        trade_method_name = (
            self._nested_str(item, "RefBuyTradeMethods", "nameRu")
            or self._nested_str(item, "RefTradeMethods", "nameRu")
            or self._nested_str(buy, "RefTradeMethods", "nameRu")
        )
        buy_id = self._int_field(item, "trdBuyId", "trd_buy_id") or self._int_field(buy, "id")
        return TenderLot(
            source=self.name,
            external_id=lot_id,
            url=self._lot_url(lot_id, buy_id),
            title=title,
            description=description,
            amount=self._decimal_field(item, "amount"),
            start_date=self._date_field(buy, "startDate", "publishDate"),
            end_date=self._date_field(buy, "endDate"),
            place=", ".join(str(part) for part in item.get("plnPointKatoList", []) if part) if isinstance(item.get("plnPointKatoList"), list) else self._str_field(item, "plnPointKatoList"),
            customer_name=customer_name,
            organizer_name=organizer_name,
            purchase_type=trade_method_name or (f"Способ закупки #{trade_method_id}" if trade_method_id else None),
            status=(status_name[:64] if status_name else str(status_id or "active")),
            documents=self._documents_from_payload(item),
            raw={
                "platform": self.name,
                "ows_schema": "v3",
                "keyword": keyword,
                "matched_keyword": keyword,
                "match_text": match_text[:4000],
                "customer_bin": customer_bin,
                "organizer_bin": organizer_bin,
                "trd_buy_number_anno": announcement_number,
                "trd_buy_id": buy_id,
                "ref_lot_status_id": status_id,
                "status_name": status_name,
                "ref_trade_methods_id": trade_method_id,
                "trade_method_name": trade_method_name,
                "last_update_date": self._str_field(item, "last_update_date", "lastUpdateDate"),
                "index_date": self._str_field(item, "index_date", "indexDate"),
                "system_id": self._int_field(item, "system_id", "systemId"),
                "raw_buy": buy,
                "raw_lot": item,
            },
        )

    def _documents_from_payload(self, item: dict[str, Any]) -> list[TenderDocument]:
        raw_files: list[Any] = []
        for value in [item.get("files"), item.get("Files")]:
            if isinstance(value, list):
                raw_files.extend(value)
        buy = item.get("TrdBuy")
        if isinstance(buy, dict):
            for value in [buy.get("files"), buy.get("Files")]:
                if isinstance(value, list):
                    raw_files.extend(value)
        docs: list[TenderDocument] = []
        seen_urls: set[str] = set()
        for file_item in raw_files:
            if not isinstance(file_item, dict):
                continue
            path = self._str_field(file_item, "filePath", "file_path")
            if not path:
                continue
            name = self._str_field(file_item, "originalName", "original_name", "nameRu", "name_ru") or path.rsplit("/", 1)[-1]
            url = self._file_url(path)
            if url in seen_urls:
                continue
            seen_urls.add(url)
            docs.append(TenderDocument(name=name, url=url, kind="document"))
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

    def _next_after(self, payload: dict[str, Any], page_lots: list[dict[str, Any]]) -> int | None:
        page_info = (payload.get("extensions") or {}).get("pageInfo") or {}
        for key in ("lastId", "last_id", "lastID"):
            value = page_info.get(key)
            if isinstance(value, int) and value > 0:
                return value
        if len(page_lots) < self.settings.zakup_ows_limit_per_page:
            return None
        return self._int_field(page_lots[-1], "id")

    def _lot_url(self, lot_id: str, buy_id: int | None) -> str:
        if buy_id:
            return f"{self.settings.zakup_public_base_url}/?lotId={lot_id}&buyId={buy_id}"
        return f"{self.settings.zakup_public_base_url}/?lotId={lot_id}"

    def _file_url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if path.startswith("/"):
            return f"{self.settings.goszakup_ows_base_url}{path}"
        return f"{self.settings.goszakup_ows_base_url}/{path}"

    def _str_field(self, item: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = item.get(key)
            if value is not None:
                return clean_text(str(value))
        return ""

    def _nested_str(self, item: dict[str, Any], object_key: str, field_key: str) -> str:
        nested = item.get(object_key)
        if not isinstance(nested, dict):
            return ""
        return self._str_field(nested, field_key)

    def _int_field(self, item: dict[str, Any], *keys: str) -> int | None:
        for key in keys:
            value = item.get(key)
            if isinstance(value, int):
                return value
            if isinstance(value, str) and value.strip().isdigit():
                return int(value.strip())
        return None

    def _decimal_field(self, item: dict[str, Any], *keys: str) -> Decimal | None:
        for key in keys:
            value = item.get(key)
            if value is None:
                continue
            try:
                return Decimal(str(value))
            except (InvalidOperation, ValueError):
                continue
        return None

    def _date_field(self, item: dict[str, Any], *keys: str) -> datetime | None:
        for key in keys:
            parsed = parse_datetime(self._str_field(item, key))
            if parsed:
                return parsed
        return None
