import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tender_parser.keywords import KeywordService
from tender_parser.rag import RagClient


class _Response:
    is_error = False
    content = b'{}'

    @staticmethod
    def json() -> dict:
        return {"indexed": True}


class _Client:
    last_headers: dict[str, str] = {}
    last_url = ""

    def __init__(self, **kwargs) -> None:
        _Client.last_headers = kwargs.get("headers", {})

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def post(self, url: str, **_kwargs) -> _Response:
        _Client.last_url = url
        return _Response()


class InternalServiceAuthenticationTest(unittest.TestCase):
    def test_rag_client_sends_token_and_escapes_lot_id(self) -> None:
        client = RagClient("http://rag", 10, True, False, " rag-service-secret ")
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "spec.pdf"
            path.write_bytes(b"document")
            with patch("tender_parser.rag.httpx.Client", _Client):
                client.index_document("source:lot id", str(path), "test")
        self.assertEqual(_Client.last_headers, {"X-Internal-Service-Token": "rag-service-secret"})
        self.assertIn("source%3Alot%20id", _Client.last_url)

    def test_dictionary_client_uses_backend_internal_token(self) -> None:
        service = KeywordService(
            db=None,  # type: ignore[arg-type]
            fallback=[],
            backend_internal_service_token=" backend-service-secret ",
        )
        self.assertEqual(service.headers, {"X-Internal-Service-Token": "backend-service-secret"})

    def test_settings_map_distinct_tokens_and_ignore_legacy_name(self) -> None:
        with patch.dict(
            os.environ,
            {
                "BACKEND_INTERNAL_SERVICE_TOKEN": "b" * 32,
                "RAG_INTERNAL_SERVICE_TOKEN": "r" * 32,
                "INTERNAL_SERVICE_TOKEN": "legacy-token-that-must-not-be-used",
            },
            clear=True,
        ):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.backend_internal_service_token, "b" * 32)
        self.assertEqual(settings.rag_internal_service_token, "r" * 32)

        with patch.dict(os.environ, {"INTERNAL_SERVICE_TOKEN": "x" * 48}, clear=True):
            legacy_only = Settings(_env_file=None)
        self.assertIsNone(legacy_only.backend_internal_service_token)
        self.assertIsNone(legacy_only.rag_internal_service_token)

        with patch.dict(
            os.environ,
            {
                "BACKEND_INTERNAL_SERVICE_TOKEN": "s" * 32,
                "RAG_INTERNAL_SERVICE_TOKEN": "s" * 32,
            },
            clear=True,
        ):
            with self.assertRaises(ValueError):
                Settings(_env_file=None)


if __name__ == "__main__":
    unittest.main()
from tender_parser.config import Settings
