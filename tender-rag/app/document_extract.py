"""Text extraction for tender documents, including OCR for scanned pages."""

from __future__ import annotations

import csv
import io
import json
import re
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader


SUPPORTED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".pptx", ".odt", ".rtf",
    ".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md",
    ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp",
}


def _norm(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1251", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _ocr_images(images: list[object]) -> str:
    import pytesseract

    parts = [pytesseract.image_to_string(image, lang="rus+eng") for image in images]
    return _norm("\n".join(parts))


def extract_text_from_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    text = _norm("\n".join(page.extract_text() or "" for page in reader.pages))
    if len(text) >= 120:
        return text
    from pdf2image import convert_from_bytes

    return _ocr_images(convert_from_bytes(data, dpi=220, fmt="jpeg", thread_count=2))


def extract_text_from_docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return _norm("\n".join(parts))


def extract_text_from_doc(data: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".doc") as source:
        source.write(data)
        source.flush()
        result = subprocess.run(
            ["antiword", source.name],
            check=False,
            capture_output=True,
            timeout=60,
        )
    if result.returncode != 0:
        raise ValueError("Не удалось прочитать старый DOC-файл")
    return _norm(_decode_text(result.stdout))


def extract_text_from_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for sheet in workbook.worksheets:
        parts.append(f"Лист: {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            values = [str(value).strip() for value in row if value is not None and str(value).strip()]
            if values:
                parts.append(" | ".join(values))
    return _norm("\n".join(parts))


def extract_text_from_xls(data: bytes) -> str:
    import xlrd

    workbook = xlrd.open_workbook(file_contents=data)
    parts: list[str] = []
    for sheet in workbook.sheets():
        parts.append(f"Лист: {sheet.name}")
        for row_index in range(sheet.nrows):
            values = [str(value).strip() for value in sheet.row_values(row_index) if str(value).strip()]
            if values:
                parts.append(" | ".join(values))
    return _norm("\n".join(parts))


def extract_text_from_pptx(data: bytes) -> str:
    from pptx import Presentation

    presentation = Presentation(io.BytesIO(data))
    parts: list[str] = []
    for index, slide in enumerate(presentation.slides, start=1):
        parts.append(f"Слайд {index}")
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                parts.append(shape.text.strip())
    return _norm("\n".join(parts))


def extract_text_from_odt(data: bytes) -> str:
    from odf import teletype
    from odf.opendocument import load
    from odf.text import P

    document = load(io.BytesIO(data))
    return _norm("\n".join(teletype.extractText(node) for node in document.getElementsByType(P)))


def extract_text_from_rtf(data: bytes) -> str:
    from striprtf.striprtf import rtf_to_text

    return _norm(rtf_to_text(_decode_text(data)))


def extract_text_from_image(data: bytes) -> str:
    from PIL import Image

    return _ocr_images([Image.open(io.BytesIO(data))])


def extract_text_from_bytes(filename: str, data: bytes) -> str:
    suffix = Path(filename or "document").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise ValueError(f"Формат {suffix or 'без расширения'} не поддерживается. Доступно: {supported}")
    if suffix == ".pdf":
        return extract_text_from_pdf(data)
    if suffix == ".docx":
        return extract_text_from_docx(data)
    if suffix == ".doc":
        return extract_text_from_doc(data)
    if suffix == ".xlsx":
        return extract_text_from_xlsx(data)
    if suffix == ".xls":
        return extract_text_from_xls(data)
    if suffix == ".pptx":
        return extract_text_from_pptx(data)
    if suffix == ".odt":
        return extract_text_from_odt(data)
    if suffix == ".rtf":
        return extract_text_from_rtf(data)
    if suffix in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}:
        return extract_text_from_image(data)
    text = _decode_text(data)
    if suffix in {".html", ".htm", ".xml"}:
        from bs4 import BeautifulSoup

        text = BeautifulSoup(text, "html.parser").get_text("\n")
    elif suffix == ".json":
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            pass
    elif suffix == ".csv":
        rows = csv.reader(io.StringIO(text))
        text = "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)
    return _norm(text)
