from __future__ import annotations

import io
import unittest
import zipfile
from contextlib import redirect_stderr
from unittest.mock import patch

from app.cloudy import (
    CloudyDocument,
    CloudySnippet,
    _normalize_sources,
    answer_cloudy_question,
    build_cloudy_prompt,
)
from app.document_extract import extract_text_from_bytes


class DocumentExtractTests(unittest.TestCase):
    def test_extracts_text_formats(self) -> None:
        self.assertIn(
            "Срок поставки",
            extract_text_from_bytes("spec.txt", "Срок поставки 10 дней".encode("utf-8")),
        )
        self.assertIn(
            "10 дней",
            extract_text_from_bytes("spec.html", "<p>Срок <b>10 дней</b></p>".encode("utf-8")),
        )
        self.assertIn(
            "бюджет",
            extract_text_from_bytes("spec.json", '{"бюджет": "1000 KZT"}'.encode("utf-8")),
        )

    def test_extracts_minimal_xlsx(self) -> None:
        buf = self._minimal_xlsx()
        text = extract_text_from_bytes("table.xlsx", buf)
        self.assertIn("Срок | 10 дней", text)

    def test_detects_xlsx_without_extension(self) -> None:
        text = extract_text_from_bytes("download_file", self._minimal_xlsx())
        self.assertIn("Срок | 10 дней", text)

    def test_corrupt_pdf_returns_empty_text_instead_of_raising(self) -> None:
        with redirect_stderr(io.StringIO()):
            text = extract_text_from_bytes("broken.pdf", b"%PDF-1.4\nbroken")
        self.assertEqual("", text)

    def _minimal_xlsx(self) -> bytes:
        buf = io.BytesIO()
        namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "xl/sharedStrings.xml",
                f'<sst xmlns="{namespace}"><si><t>Срок</t></si><si><t>10 дней</t></si></sst>',
            )
            zf.writestr(
                "xl/worksheets/sheet1.xml",
                (
                    f'<worksheet xmlns="{namespace}"><sheetData><row>'
                    '<c t="s"><v>0</v></c><c t="s"><v>1</v></c>'
                    "</row></sheetData></worksheet>"
                ),
            )
        return buf.getvalue()


class CloudyPromptTests(unittest.TestCase):
    def test_build_prompt_contains_current_lot_and_sources(self) -> None:
        prompt = build_cloudy_prompt(
            question="Какой срок?",
            lot_context="Название: тестовый лот",
            history=[{"role": "user", "content": "Привет"}],
            documents=[CloudyDocument(name="ТС.pdf", text="Срок 10 дней")],
            snippets=[CloudySnippet(document="ТС.pdf", chunk_index=0, text="Срок 10 дней", score=0.9)],
            spec_summary={"overview": "Тест"},
            warnings=["нет OCR"],
        )
        self.assertIn("Название: тестовый лот", prompt)
        self.assertIn("Какой срок?", prompt)
        self.assertIn("ТС.pdf", prompt)
        self.assertIn("Срок 10 дней", prompt)
        self.assertIn("нет OCR", prompt)

    def test_answer_falls_back_to_snippets_when_ai_fails(self) -> None:
        with patch("app.cloudy.ai_chat", side_effect=RuntimeError("temporary outage")):
            response = answer_cloudy_question(
                question="Какой срок?",
                lot_context="Название: тестовый лот",
                history=[],
                documents=[CloudyDocument(name="ТС.pdf", text="Срок поставки 10 дней")],
                warnings=[],
            )
        self.assertIn("релевантные данные", response["answer"])
        self.assertTrue(response["sources"])
        self.assertTrue(response["warnings"])

    def test_sources_use_extracted_snippets_over_ai_quotes(self) -> None:
        sources = _normalize_sources(
            [{"document": "ТС.txt", "snippet": "?????????? SLA 99.9%"}],
            [CloudySnippet(document="ТС.txt", chunk_index=0, text="Техническая спецификация: SLA 99.9%", score=1.0)],
        )
        self.assertEqual("Техническая спецификация: SLA 99.9%", sources[0]["snippet"])


if __name__ == "__main__":
    unittest.main()
