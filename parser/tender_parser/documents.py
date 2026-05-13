from pathlib import Path
from urllib.parse import urljoin

import httpx

from tender_parser.fingerprints import bytes_sha256
from tender_parser.schemas import TenderDocument, TenderLot
from tender_parser.text_extract import extract_text_from_bytes

SPEC_MARKERS = ("тех", "специф", "тз", "техничес", "technical", "specification")
PROTOCOL_MARKERS = ("протокол", "итог", "итоги", "protocol", "result")
SUPPORTED_EXTENSIONS = (".pdf", ".docx", ".doc", ".txt")
SUPPORTED_CONTENT_TYPES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "text/plain",
)


class DocumentService:
    def __init__(self, download_dir: Path, timeout_seconds: int) -> None:
        self.download_dir = download_dir
        self.timeout_seconds = timeout_seconds
        self.download_dir.mkdir(parents=True, exist_ok=True)

    def pick_spec_documents(self, lot: TenderLot) -> list[TenderDocument]:
        selected = [doc for doc in lot.documents if self._is_supported(doc) and self._has_marker(doc.name, SPEC_MARKERS)]
        if selected:
            return selected
        return [doc for doc in lot.documents if self._is_supported(doc)][:2]

    def pick_protocol_documents(self, lot: TenderLot) -> list[TenderDocument]:
        return [doc for doc in lot.documents if self._is_supported(doc) and self._has_marker(doc.name, PROTOCOL_MARKERS)]

    def download(self, lot: TenderLot, doc: TenderDocument) -> tuple[bytes, TenderDocument]:
        url = urljoin(lot.url, doc.url)
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True, headers={"User-Agent": "TenderMachineV2Parser/1.0"}) as client:
            res = client.get(url)
            res.raise_for_status()
            data = res.content
        content_type = (res.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if not self._looks_like_supported_file(url, doc.name, content_type, data):
            raise ValueError(f"unsupported document response: content_type={content_type or 'unknown'} url={url}")
        digest = bytes_sha256(data)
        safe_name = self._safe_filename(doc.name or Path(url).name or "document")
        target_dir = self.download_dir / lot.source / lot.external_id
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / f"{digest[:12]}-{safe_name}"
        path.write_bytes(data)
        doc.sha256 = digest
        doc.local_path = str(path)
        doc.content_type = doc.content_type or content_type
        return data, doc

    def extract_text(self, doc: TenderDocument, data: bytes) -> str:
        return extract_text_from_bytes(doc.name, data)

    def _is_supported(self, doc: TenderDocument) -> bool:
        name = (doc.name or doc.url).lower()
        return any(name.endswith(ext) for ext in SUPPORTED_EXTENSIONS) or any(marker in name for marker in (*SPEC_MARKERS, *PROTOCOL_MARKERS))

    def _looks_like_supported_file(self, url: str, name: str, content_type: str, data: bytes) -> bool:
        lowered = f"{url} {name}".lower()
        if data.startswith(b"%PDF"):
            return True
        if data.startswith(b"PK\x03\x04") and any(marker in lowered for marker in (".docx", "тех", "специф", "тз", "протокол")):
            return True
        if content_type and any(content_type.startswith(allowed) for allowed in SUPPORTED_CONTENT_TYPES):
            return True
        if any(lowered.endswith(ext) for ext in SUPPORTED_EXTENSIONS):
            return True
        return False

    def _has_marker(self, value: str, markers: tuple[str, ...]) -> bool:
        lowered = value.lower()
        return any(marker in lowered for marker in markers)

    def _safe_filename(self, value: str) -> str:
        return "".join(ch if ch.isalnum() or ch in ".-_() " else "_" for ch in value).strip()[:160] or "document"
