from pathlib import Path
from typing import Any

import httpx


class RagClient:
    def __init__(self, base_url: str, timeout_seconds: int, extract_spec_points: bool, include_extracted_text: bool) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.extract_spec_points = extract_spec_points
        self.include_extracted_text = include_extracted_text

    def index_document(self, lot_id: str, path: str, source_hint: str) -> dict[str, Any]:
        file_path = Path(path)
        with file_path.open("rb") as fh:
            files = {"file": (file_path.name, fh, "application/octet-stream")}
            data = {
                "source_hint": source_hint,
                "extract_spec_points": str(self.extract_spec_points).lower(),
                "include_extracted_text": str(self.include_extracted_text).lower(),
            }
            with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
                res = client.post(f"{self.base_url}/v1/lots/{lot_id}/index-document", data=data, files=files)
                if res.is_error:
                    raise RuntimeError(f"RAG {res.status_code}: {res.text[:1000]}")
                return res.json()

    def index_text(self, lot_id: str, text: str, source_hint: str) -> dict[str, Any]:
        payload = {"text": text, "source_hint": source_hint, "extract_spec_points": self.extract_spec_points}
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
            res = client.post(f"{self.base_url}/v1/lots/{lot_id}/index", json=payload)
            if res.is_error:
                raise RuntimeError(f"RAG {res.status_code}: {res.text[:1000]}")
            if not res.content:
                return {}
            return res.json()

    def analyze_lot(self, lot_text: str, profile: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"lot_text": lot_text}
        if profile:
            payload["profile"] = profile
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
            res = client.post(f"{self.base_url}/v1/lot/analyze", json=payload)
            if res.is_error:
                raise RuntimeError(f"RAG {res.status_code}: {res.text[:1000]}")
            return res.json()
