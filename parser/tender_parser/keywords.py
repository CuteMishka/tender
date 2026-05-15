from typing import Any

import httpx
import structlog

from tender_parser.db import Database


log = structlog.get_logger("tender_parser.keywords")


class KeywordService:
    def __init__(self, db: Database, fallback: list[str], dictionaries_api_url: str | None = None, timeout_seconds: int = 10) -> None:
        self.db = db
        self.fallback = fallback
        self.dictionaries_api_url = dictionaries_api_url
        self.timeout_seconds = timeout_seconds

    def load_active(self) -> list[str]:
        api_keywords = self._load_from_api()
        if api_keywords:
            return api_keywords
        return self.db.load_keywords(self.fallback)

    def _load_from_api(self) -> list[str]:
        if not self.dictionaries_api_url:
            return []
        try:
            with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
                response = client.get(self.dictionaries_api_url)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            log.warning("dictionary_api_unavailable", url=self.dictionaries_api_url, error=str(exc))
            return []
        keywords = self._extract_keywords(payload)
        if not keywords:
            log.warning("dictionary_api_empty", url=self.dictionaries_api_url)
        return keywords

    def _extract_keywords(self, payload: Any) -> list[str]:
        values: list[str] = []
        if isinstance(payload, list):
            for item in payload:
                value = self._item_value(item)
                active = self._item_active(item)
                if value and active:
                    values.append(value)
        elif isinstance(payload, dict):
            candidates = payload.get("keywords") or payload.get("items") or payload.get("data") or []
            if isinstance(candidates, dict):
                candidates = candidates.get("keywords") or []
            values.extend(self._extract_keywords(candidates))
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            normalized = value.strip()
            key = normalized.lower()
            if normalized and key not in seen:
                seen.add(key)
                result.append(normalized)
        return result

    def _item_value(self, item: Any) -> str:
        if isinstance(item, str):
            return item
        if isinstance(item, dict):
            value = item.get("value") or item.get("name") or item.get("keyword") or item.get("text")
            return str(value or "")
        return ""

    def _item_active(self, item: Any) -> bool:
        if isinstance(item, dict) and "active" in item:
            return bool(item.get("active"))
        return True
