from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx

from tender_parser.platforms.tenderplus import TenderPlusPlatform


def lot_row(lot_id: int) -> dict:
    return {
        "id": lot_id,
        "title": f"Lot {lot_id}",
        "description": "Cloud service",
        "partnerLink": f"https://example.test/lots/{lot_id}",
        "lotBuy": {"lotStatus": {"name": "active"}},
    }


def page_response(rows: list[dict], status_code: int = 200) -> httpx.Response:
    request = httpx.Request("POST", "https://api.tenderplus.test/graphql")
    return httpx.Response(status_code, request=request, json={"data": {"lot": rows}})


class SequenceClient:
    def __init__(self, outcomes: list[object]) -> None:
        self.outcomes = outcomes
        self.calls = 0

    def __enter__(self) -> "SequenceClient":
        return self

    def __exit__(self, *_args) -> None:
        return None

    def post(self, *_args, **_kwargs) -> httpx.Response:
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome  # type: ignore[return-value]


def settings(**overrides):
    values = {
        "tenderplus_token": "token",
        "tenderplus_page_size": 2,
        "tenderplus_max_pages": 0,
        "tenderplus_max_lots": 10,
        "tenderplus_url": "https://api.tenderplus.test/graphql",
        "tenderplus_include_documents": False,
        "collect_all_active_lots": True,
        "request_timeout_seconds": 5,
        "retry_attempts": 3,
        "retry_backoff_seconds": 0.1,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class TenderPlusNetworkResilienceTest(unittest.TestCase):
    def test_retries_transport_error_and_disables_environment_proxy(self) -> None:
        request = httpx.Request("POST", "https://api.tenderplus.test/graphql")
        client = SequenceClient(
            [
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
                page_response([lot_row(101)]),
            ]
        )
        client_kwargs: dict = {}

        def client_factory(**kwargs):
            client_kwargs.update(kwargs)
            return client

        platform = TenderPlusPlatform(settings())
        with (
            patch("tender_parser.platforms.tenderplus.httpx.Client", side_effect=client_factory),
            patch.object(platform, "_documents", return_value=[]),
            patch("tender_parser.platforms.tenderplus.time.sleep") as sleep,
        ):
            lots = platform.search([])

        self.assertEqual([lot.external_id for lot in lots], ["101"])
        self.assertEqual(client.calls, 2)
        self.assertIs(client_kwargs["trust_env"], False)
        sleep.assert_called_once_with(0.1)

    def test_retries_transient_http_status(self) -> None:
        client = SequenceClient(
            [
                page_response([], status_code=503),
                page_response([lot_row(102)]),
            ]
        )
        platform = TenderPlusPlatform(settings())

        with (
            patch("tender_parser.platforms.tenderplus.httpx.Client", return_value=client),
            patch.object(platform, "_documents", return_value=[]),
            patch("tender_parser.platforms.tenderplus.time.sleep"),
        ):
            lots = platform.search([])

        self.assertEqual([lot.external_id for lot in lots], ["102"])
        self.assertEqual(client.calls, 2)

    def test_later_page_failure_returns_accumulated_lots(self) -> None:
        request = httpx.Request("POST", "https://api.tenderplus.test/graphql")
        client = SequenceClient(
            [
                page_response([lot_row(201)]),
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
            ]
        )
        platform = TenderPlusPlatform(settings(tenderplus_page_size=1))

        with (
            patch("tender_parser.platforms.tenderplus.httpx.Client", return_value=client),
            patch.object(platform, "_documents", return_value=[]),
            patch("tender_parser.platforms.tenderplus.time.sleep"),
        ):
            lots = platform.search([])

        self.assertEqual([lot.external_id for lot in lots], ["201"])
        self.assertEqual(client.calls, 4)

    def test_first_page_failure_is_raised_after_all_attempts(self) -> None:
        request = httpx.Request("POST", "https://api.tenderplus.test/graphql")
        client = SequenceClient(
            [
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
                httpx.ConnectTimeout("TLS handshake timed out", request=request),
            ]
        )
        platform = TenderPlusPlatform(settings())

        with (
            patch("tender_parser.platforms.tenderplus.httpx.Client", return_value=client),
            patch("tender_parser.platforms.tenderplus.time.sleep"),
        ):
            with self.assertRaises(httpx.ConnectTimeout):
                platform.search([])

        self.assertEqual(client.calls, 3)


if __name__ == "__main__":
    unittest.main()
