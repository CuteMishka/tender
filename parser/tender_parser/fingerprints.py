import hashlib
import json
from typing import Any


def stable_json_hash(payload: dict[str, Any]) -> str:
    normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
