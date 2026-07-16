import tempfile
import unittest
from pathlib import Path

from tender_parser.documents import DocumentService
from tender_parser.schemas import TenderDocument, TenderLot


def document(name: str, url: str = "https://files.example/download") -> TenderDocument:
    return TenderDocument(name=name, url=url)


def lot_with_documents(documents: list[TenderDocument]) -> TenderLot:
    return TenderLot(
        source="tenderplus",
        external_id="51789485",
        url="https://tenderplus.kz/zakupki/51789485",
        title="Test lot",
        documents=documents,
    )


class DocumentServiceSpecPickerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.service = DocumentService(Path(self.temp_dir.name), timeout_seconds=5)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_prefers_real_techspec_over_first_appendix(self) -> None:
        docs = [
            document("appendix_7_17271944.pdf"),
            document("techspec_86747976.pdf"),
            document("ТС ЦОД 05.06.docx"),
        ]

        picked = self.service.pick_spec_documents(lot_with_documents(docs))

        self.assertEqual([doc.name for doc in picked], ["techspec_86747976.pdf", "ТС ЦОД 05.06.docx"])

    def test_recognizes_synchronized_russian_and_english_markers(self) -> None:
        for name in (
            "ТС ЦОД.docx",
            "Т.З. на услуги.pdf",
            "Техническая спецификация.pdf",
            "technical_specification.docx",
            "service-specification.pdf",
        ):
            with self.subTest(name=name):
                docs = [document("appendix_7.pdf"), document(name)]
                picked = self.service.pick_spec_documents(lot_with_documents(docs))
                self.assertEqual([doc.name for doc in picked], [name])

    def test_keeps_appendix_as_fallback(self) -> None:
        docs = [document("appendix_7.pdf"), document("contract_project.pdf")]

        picked = self.service.pick_spec_documents(lot_with_documents(docs))

        self.assertEqual([doc.name for doc in picked], ["appendix_7.pdf", "contract_project.pdf"])

    def test_ts_abbreviation_must_be_standalone(self) -> None:
        self.assertFalse(self.service._has_spec_marker("отсчет оказанных услуг.pdf"))
        self.assertFalse(self.service._has_spec_marker("өтсін.pdf"))


if __name__ == "__main__":
    unittest.main()
