import unittest
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

from tender_parser.ai_suitability import GroqSuitabilityClient
from tender_parser.schemas import TenderLot
from tender_parser.scheduler import ParserScheduler


def suitability_client(*, require_spec_text: bool = False) -> GroqSuitabilityClient:
    return GroqSuitabilityClient(
        api_key=None,
        base_url="http://llm:11434/v1",
        model="qwen2.5:3b",
        timeout_seconds=5,
        min_score=50,
        company_profile=None,
        context_keywords=[],
        provider="groq",
        require_spec_text=require_spec_text,
    )


def gpu_lot(*, with_spec: bool = True) -> TenderLot:
    raw = {}
    if with_spec:
        raw["spec_text_sample"] = (
            "Исполнитель предоставляет услуги аренды графических вычислительных мощностей GPU, "
            "виртуальные машины, vCPU, vRAM и хранение данных в центре обработки данных."
        )
    return TenderLot(
        source="tenderplus",
        external_id="74306",
        url="https://example.test/74306",
        title="Услуги по предоставлению вычислительных мощностей",
        description="GPU hosting и облачная инфраструктура",
        purchase_type="Услуга",
        raw=raw,
    )


class DeterministicSuitabilityFallbackTest(unittest.TestCase):
    def test_strong_spec_is_promoted_when_llm_is_unavailable(self) -> None:
        result = suitability_client(require_spec_text=True).deterministic_fallback(gpu_lot())

        self.assertIsNotNone(result)
        assert result is not None
        self.assertGreater(result["score"], 50)
        self.assertTrue(result["passed"])
        self.assertTrue(result["is_suitable"])
        self.assertEqual(result["fallback_source"], "spec")
        self.assertEqual(result["provider"], "local-llm")

    def test_required_spec_never_promotes_card_only_lot(self) -> None:
        result = suitability_client(require_spec_text=True).deterministic_fallback(gpu_lot(with_spec=False))

        self.assertIsNone(result)

    def test_card_can_be_used_when_spec_is_not_required(self) -> None:
        result = suitability_client(require_spec_text=False).deterministic_fallback(gpu_lot(with_spec=False))

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result["passed"])
        self.assertEqual(result["fallback_source"], "card")


class SchedulerFallbackTest(unittest.TestCase):
    def scheduler(self, client: GroqSuitabilityClient) -> ParserScheduler:
        scheduler = object.__new__(ParserScheduler)
        scheduler.settings = SimpleNamespace(
            ai_lot_filter_enabled=True,
            ai_require_spec_text=False,
            ai_rate_limit_cooldown_seconds=120,
            ai_request_delay_seconds=0,
        )
        scheduler.ai_suitability = client
        scheduler.log = Mock()
        scheduler._ai_lock = Lock()
        scheduler._ai_cooldown_until = 0.0
        scheduler._last_ai_request_at = 0.0
        scheduler._stop_words = []
        scheduler._reject_by_stop_word = Mock(return_value=False)
        return scheduler

    def test_llm_exception_saves_deterministic_score_and_error_telemetry(self) -> None:
        client = suitability_client()
        client.analyze = Mock(side_effect=RuntimeError("connection refused"))
        scheduler = self.scheduler(client)
        lot = gpu_lot()

        scheduler._analyze_lot_with_ai(lot)

        self.assertEqual(lot.raw["ai_filter_status"], "deterministic_fallback")
        self.assertGreater(lot.raw["ai_score"], 50)
        self.assertTrue(lot.raw["is_suitable"])
        self.assertEqual(lot.raw["ai_last_error_status"], "error")
        self.assertIn("connection refused", lot.raw["ai_last_error"])
        self.assertEqual(lot.raw["match_method"], "deterministic_spec_fallback")

    def test_unrelated_lot_keeps_error_and_zero_score(self) -> None:
        client = suitability_client()
        client.analyze = Mock(side_effect=RuntimeError("connection refused"))
        scheduler = self.scheduler(client)
        lot = TenderLot(
            source="tenderplus",
            external_id="unrelated",
            url="https://example.test/unrelated",
            title="Услуги по уборке помещений",
            description="Ежедневная влажная уборка офиса",
            purchase_type="Услуга",
            raw={"spec_text_sample": "График уборки помещений и требования к моющим средствам."},
        )

        scheduler._analyze_lot_with_ai(lot)

        self.assertEqual(lot.raw["ai_filter_status"], "error")
        self.assertEqual(lot.raw["ai_score"], 0)
        self.assertFalse(lot.raw["is_suitable"])

    def test_rate_limit_uses_fallback_and_enables_cooldown(self) -> None:
        client = suitability_client()
        client.analyze = Mock(side_effect=RuntimeError("429 Too Many Requests"))
        scheduler = self.scheduler(client)
        first = gpu_lot()

        scheduler._analyze_lot_with_ai(first)
        second = gpu_lot()
        second.external_id = "74307"
        scheduler._analyze_lot_with_ai(second)

        self.assertEqual(first.raw["ai_filter_status"], "deterministic_fallback")
        self.assertEqual(first.raw["ai_last_error_status"], "rate_limited")
        self.assertEqual(second.raw["ai_filter_status"], "deterministic_fallback")
        self.assertEqual(second.raw["ai_last_error_status"], "cooldown")
        self.assertEqual(client.analyze.call_count, 1)

    def test_previous_success_is_preserved_during_cooldown(self) -> None:
        client = suitability_client()
        scheduler = self.scheduler(client)
        scheduler._ai_cooldown_until = float("inf")
        lot = gpu_lot()
        lot.raw.update(
            {
                "ai_provider": "local-llm",
                "ai_filter_status": "ok",
                "ai_score": 92,
                "is_suitable": True,
                "match_reason": "Предыдущая успешная оценка",
            }
        )

        scheduler._analyze_lot_with_ai(lot)

        self.assertEqual(lot.raw["ai_filter_status"], "ok")
        self.assertEqual(lot.raw["ai_score"], 92)
        self.assertTrue(lot.raw["is_suitable"])
        self.assertEqual(lot.raw["ai_last_error_status"], "cooldown")


if __name__ == "__main__":
    unittest.main()
