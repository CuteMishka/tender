import csv
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import httpx
import structlog

from tender_parser.db import Database


log = structlog.get_logger("tender_parser.keywords")


SKIP_VALUES = {
    "keyword",
    "keywords",
    "key word",
    "key words",
    "ключ",
    "ключи",
    "ключевое слово",
    "ключевые слова",
    "обозначение",
}


@dataclass(frozen=True, slots=True)
class KeywordRule:
    value: str
    min_amount: Decimal | None = None
    item_id: str | None = None


class KeywordService:
    def __init__(
        self,
        db: Database,
        fallback: list[str],
        dictionaries_api_url: str | None = None,
        timeout_seconds: int = 10,
        keywords_file_path: Path | None = None,
        stop_words_api_url: str | None = None,
        fallback_stop_words: list[str] | None = None,
        backend_internal_service_token: str | None = None,
    ) -> None:
        self.db = db
        self.fallback = fallback
        self.dictionaries_api_url = dictionaries_api_url
        self.timeout_seconds = timeout_seconds
        self.keywords_file_path = keywords_file_path
        self.stop_words_api_url = stop_words_api_url
        self.fallback_stop_words = fallback_stop_words or []
        self._active_rules: dict[str, KeywordRule] = {}
        self.headers = {"X-Internal-Service-Token": backend_internal_service_token.strip()} if backend_internal_service_token and backend_internal_service_token.strip() else {}

    def load_active(self, stop_words: list[str] | None = None) -> list[str]:
        return [rule.value for rule in self.load_active_rules(stop_words)]

    def load_active_rules(self, stop_words: list[str] | None = None) -> list[KeywordRule]:
        excluded_keys = self._normalized_set(stop_words or [])
        file_keywords = self._load_from_file(excluded_keys)
        if file_keywords:
            self.db.seed_keywords(file_keywords)
            return self._set_active_rules(KeywordRule(value=value) for value in file_keywords)
        api_rules = self._load_rules_from_api(excluded_keys)
        if api_rules:
            self.db.seed_keywords([rule.value for rule in api_rules])
            return self._set_active_rules(api_rules)
        fallback_keywords = self._dedupe(self.db.load_keywords(self.fallback), excluded_keys)
        return self._set_active_rules(KeywordRule(value=value) for value in fallback_keywords)

    def min_amount_for(self, keyword: str | None) -> Decimal | None:
        if not keyword:
            return None
        rule = self._active_rules.get(self._normalized_key(keyword))
        return rule.min_amount if rule else None

    def update_last_lot(self, keyword: str | None, last_lot: str | None) -> None:
        if not keyword or not last_lot or not self.dictionaries_api_url:
            return
        rule = self._active_rules.get(self._normalized_key(keyword))
        if rule is None or not rule.item_id:
            return
        url = self._api_url_for_item(rule.item_id)
        if not url:
            return
        payload: dict[str, Any] = {"lastLot": str(last_lot)}
        try:
            with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers=self.headers) as client:
                response = client.put(url, json=payload)
                response.raise_for_status()
        except Exception as exc:
            log.warning("dictionary_last_lot_update_failed", url=url, keyword=keyword, last_lot=last_lot, error=str(exc))

    def load_stop_words(self) -> list[str]:
        api_stop_words = self._load_values_from_api(self.stop_words_api_url or self._api_url_for_kind("stop_words"), "stop_words_api")
        if api_stop_words:
            return api_stop_words
        return self._dedupe(self.fallback_stop_words)

    def find_stop_word(self, text: str, stop_words: list[str]) -> str | None:
        normalized_text = f" {self._normalize_for_match(text)} "
        if not normalized_text.strip():
            return None
        for stop_word in sorted(stop_words, key=len, reverse=True):
            normalized = self._normalize_for_match(stop_word)
            if not normalized:
                continue
            if " " in normalized:
                if normalized in normalized_text:
                    return stop_word
                continue
            pattern = rf"(?<![a-zа-я0-9]){re.escape(normalized)}(?![a-zа-я0-9])"
            if re.search(pattern, normalized_text):
                return stop_word
        return None

    def _load_from_file(self, excluded_keys: set[str]) -> list[str]:
        if self.keywords_file_path is None:
            return []
        path = self.keywords_file_path.expanduser()
        if not path.exists():
            log.warning("keywords_file_missing", path=str(path))
            return []
        try:
            suffix = path.suffix.lower()
            if suffix == ".xlsx":
                values = self._read_xlsx_values(path)
            elif suffix in {".csv", ".tsv", ".txt"}:
                values = self._read_text_values(path)
            else:
                log.warning("keywords_file_unsupported", path=str(path), suffix=suffix)
                return []
        except Exception as exc:
            log.warning("keywords_file_unavailable", path=str(path), error=str(exc))
            return []
        keywords = self._dedupe(values, excluded_keys)
        if not keywords:
            log.warning("keywords_file_empty", path=str(path))
        else:
            log.info("keywords_file_loaded", path=str(path), keywords_count=len(keywords))
        return keywords

    def _load_from_api(self, excluded_keys: set[str]) -> list[str]:
        return self._load_values_from_api(self.dictionaries_api_url, "dictionary_api", excluded_keys)

    def _load_rules_from_api(self, excluded_keys: set[str]) -> list[KeywordRule]:
        if not self.dictionaries_api_url:
            return []
        try:
            with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers=self.headers) as client:
                response = client.get(self.dictionaries_api_url)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            log.warning("dictionary_api_unavailable", source="dictionary_api", url=self.dictionaries_api_url, error=str(exc))
            return []
        rules = self._extract_rules(payload)
        deduped = self._dedupe_rules(rules, excluded_keys)
        if not deduped:
            log.warning("dictionary_api_empty", source="dictionary_api", url=self.dictionaries_api_url)
        else:
            log.info("dictionary_api_loaded", source="dictionary_api", url=self.dictionaries_api_url, values_count=len(deduped))
        return deduped

    def _load_values_from_api(self, url: str | None, source: str, excluded_keys: set[str] | None = None) -> list[str]:
        if not url:
            return []
        try:
            with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers=self.headers) as client:
                response = client.get(url)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            log.warning("dictionary_api_unavailable", source=source, url=url, error=str(exc))
            return []
        values = self._extract_values(payload, source)
        deduped = self._dedupe(values, excluded_keys or set())
        if not deduped:
            log.warning("dictionary_api_empty", source=source, url=url)
        else:
            log.info("dictionary_api_loaded", source=source, url=url, values_count=len(deduped))
        return deduped

    def _set_active_rules(self, rules: Any) -> list[KeywordRule]:
        normalized: list[KeywordRule] = []
        self._active_rules = {}
        for rule in rules:
            if isinstance(rule, KeywordRule):
                item = rule
            else:
                item = KeywordRule(value=str(rule or ""))
            value = " ".join(item.value.strip().split())
            key = self._normalized_key(value)
            if not value or not key or key in self._active_rules:
                continue
            normalized_rule = KeywordRule(value=value, min_amount=item.min_amount, item_id=item.item_id)
            self._active_rules[key] = normalized_rule
            normalized.append(normalized_rule)
        return normalized

    def _extract_values(self, payload: Any, source: str = "") -> list[str]:
        values: list[str] = []
        if isinstance(payload, list):
            for item in payload:
                value = self._item_value(item)
                active = self._item_active(item)
                if value and active:
                    values.append(value)
        elif isinstance(payload, dict):
            candidates = []
            if source == "stop_words_api":
                candidates = payload.get("stopWords") or payload.get("stop_words") or []
            if not candidates:
                candidates = payload.get("keywords") or payload.get("items") or payload.get("data") or []
            if isinstance(candidates, dict):
                candidates = candidates.get("keywords") or []
            values.extend(self._extract_values(candidates, source))
        return self._dedupe(values)

    def _extract_rules(self, payload: Any) -> list[KeywordRule]:
        rules: list[KeywordRule] = []
        if isinstance(payload, list):
            for item in payload:
                rule = self._item_rule(item)
                if rule:
                    rules.append(rule)
        elif isinstance(payload, dict):
            candidates = payload.get("items") or payload.get("data") or payload.get("keywords") or []
            if isinstance(candidates, dict):
                candidates = candidates.get("items") or candidates.get("data") or candidates.get("keywords") or []
            rules.extend(self._extract_rules(candidates))
        return rules

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

    def _item_rule(self, item: Any) -> KeywordRule | None:
        value = self._item_value(item)
        if not value or not self._item_active(item):
            return None
        min_amount = None
        item_id = None
        if isinstance(item, dict):
            min_amount = self._decimal_or_none(
                item.get("minAmount")
                or item.get("min_amount")
                or item.get("minimumAmount")
                or item.get("minimum_amount")
                or item.get("minSum")
                or item.get("min_sum")
            )
            raw_id = item.get("id")
            item_id = str(raw_id) if raw_id is not None and str(raw_id).strip() else None
        return KeywordRule(value=value, min_amount=min_amount, item_id=item_id)

    def _dedupe(self, values: list[str], excluded_keys: set[str] | None = None) -> list[str]:
        excluded_keys = excluded_keys or set()
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            normalized = " ".join(str(value).strip().split())
            key = self._normalized_key(normalized)
            if not normalized or key in SKIP_VALUES or key in excluded_keys or key in seen:
                continue
            seen.add(key)
            result.append(normalized)
        return result

    def _dedupe_rules(self, rules: list[KeywordRule], excluded_keys: set[str] | None = None) -> list[KeywordRule]:
        excluded_keys = excluded_keys or set()
        seen: set[str] = set()
        result: list[KeywordRule] = []
        for rule in rules:
            normalized = " ".join(str(rule.value).strip().split())
            key = self._normalized_key(normalized)
            if not normalized or key in SKIP_VALUES or key in excluded_keys or key in seen:
                continue
            seen.add(key)
            result.append(KeywordRule(value=normalized, min_amount=rule.min_amount, item_id=rule.item_id))
        return result

    def _decimal_or_none(self, value: Any) -> Decimal | None:
        if value is None:
            return None
        try:
            if isinstance(value, Decimal):
                amount = value
            else:
                amount = Decimal(str(value).replace("\u00a0", " ").replace(" ", "").replace(",", "."))
        except (InvalidOperation, ValueError):
            return None
        return amount if amount > 0 else None

    def _normalized_set(self, values: list[str]) -> set[str]:
        return {self._normalized_key(value) for value in values if self._normalized_key(value)}

    def _normalized_key(self, value: str) -> str:
        return self._normalize_for_match(value)

    def _normalize_for_match(self, value: str) -> str:
        return re.sub(r"\s+", " ", str(value).strip().lower().replace("ё", "е"))

    def _api_url_for_kind(self, kind: str) -> str | None:
        if not self.dictionaries_api_url:
            return None
        parts = urlsplit(self.dictionaries_api_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["kind"] = kind
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    def _api_url_for_item(self, item_id: str) -> str | None:
        if not self.dictionaries_api_url:
            return None
        parts = urlsplit(self.dictionaries_api_url)
        path = f"{parts.path.rstrip('/')}/{item_id}"
        return urlunsplit((parts.scheme, parts.netloc, path, "", parts.fragment))

    def _read_text_values(self, path: Path) -> list[str]:
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        if path.suffix.lower() == ".txt":
            return path.read_text(encoding="utf-8-sig").splitlines()
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [cell for row in csv.reader(handle, delimiter=delimiter) for cell in row]

    def _read_xlsx_values(self, path: Path) -> list[str]:
        ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        with ZipFile(path) as archive:
            names = set(archive.namelist())
            shared_strings = self._read_shared_strings(archive, names, ns)
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
            values: list[str] = []
            for sheet in workbook.findall("a:sheets/a:sheet", ns):
                rel_id = sheet.attrib.get(rel_ns)
                target = relmap.get(rel_id or "")
                if not target:
                    continue
                sheet_path = self._xlsx_path(target)
                if sheet_path not in names:
                    continue
                root = ET.fromstring(archive.read(sheet_path))
                for cell in root.findall(".//a:sheetData/a:row/a:c", ns):
                    value = self._xlsx_cell_value(cell, shared_strings, ns)
                    if value:
                        values.append(value)
            return values

    def _read_shared_strings(self, archive: ZipFile, names: set[str], ns: dict[str, str]) -> list[str]:
        if "xl/sharedStrings.xml" not in names:
            return []
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        return ["".join(node.text or "" for node in item.findall(".//a:t", ns)) for item in root.findall("a:si", ns)]

    def _xlsx_cell_value(self, cell: ET.Element, shared_strings: list[str], ns: dict[str, str]) -> str:
        if cell.attrib.get("t") == "inlineStr":
            return "".join(node.text or "" for node in cell.findall(".//a:t", ns)).strip()
        node = cell.find("a:v", ns)
        if node is None or node.text is None:
            return ""
        value = node.text.strip()
        if cell.attrib.get("t") == "s":
            try:
                return shared_strings[int(value)].strip()
            except (IndexError, ValueError):
                return ""
        return value

    def _xlsx_path(self, target: str) -> str:
        normalized = target.lstrip("/")
        if normalized.startswith("xl/"):
            return normalized
        return f"xl/{normalized}".replace("xl/xl/", "xl/")
