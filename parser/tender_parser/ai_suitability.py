import json
import re
from typing import Any

import httpx

from tender_parser.schemas import TenderLot


class GroqSuitabilityClient:
    def __init__(
        self,
        api_key: str | None,
        base_url: str,
        model: str,
        timeout_seconds: int,
        min_score: int,
        company_profile: str | None,
        context_keywords: list[str],
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.min_score = min_score
        self.company_profile = (company_profile or "").strip()
        self.context_keywords = context_keywords

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def analyze(self, lot: TenderLot) -> dict[str, Any]:
        if not self.enabled:
            return {"score": 0, "passed": False, "reason": "GROQ_API_KEY is not configured"}
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": self._user_prompt(lot)},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
            response = client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        content = str(data.get("choices", [{}])[0].get("message", {}).get("content") or "")
        result = self._parse_json(content)
        score = self._normalize_score(result.get("score"))
        result["score"] = score
        result["passed"] = score >= self.min_score and bool(result.get("is_suitable", score >= self.min_score))
        result["provider"] = "groq"
        result["model"] = self.model
        return result

    def _system_prompt(self) -> str:
        keywords = ", ".join(self.context_keywords)
        return (
            "Ты эксперт по государственным закупкам и облачной IT-инфраструктуре. "
            "Оценивай, подходит ли тендер компании Freedom Cloud. "
            "Компания занимается хостингом, облачными серверами, виртуальными серверами, VPS/VDS, "
            "выделенными серверами, IaaS/PaaS/SaaS, дата-центрами, хранением данных, backup, "
            "виртуализацией, Kubernetes, Linux, сетевой инфраструктурой и информационной безопасностью. "
            "Если переданы услуги или фрагмент технической спецификации, оценивай пригодность в первую очередь по ним, "
            "а не только по названию карточки лота. "
            "Смысловая близость важнее точного совпадения слов. Например, закупки серверных мощностей, "
            "аренды вычислительных ресурсов, облачной инфраструктуры, размещения оборудования, backup, "
            "сетевой безопасности или администрирования серверов должны считаться подходящими. "
            "Не считай подходящими бытовые товары, канцтовары, продукты, строительство, медицину, мебель, "
            "услуги не связанные с IT-инфраструктурой. "
            f"Профиль компании: {self.company_profile}. "
            f"Контекстные слова: {keywords}. "
            "Ответь только JSON объектом: "
            "{\"is_suitable\": boolean, \"score\": 0-100, \"matched_theme\": string, \"reason\": string, \"keywords\": [string], \"spec_context_used\": boolean}."
        )

    def _user_prompt(self, lot: TenderLot) -> str:
        raw_parts = [
            str(lot.raw.get("match_text") or ""),
            str(lot.raw.get("announce_title") or ""),
            str(lot.raw.get("row_text") or ""),
            str(lot.raw.get("detail_text_sample") or ""),
        ]
        spec_summary = lot.raw.get("spec_summary")
        spec_services = lot.raw.get("spec_services")
        spec_text_sample = str(lot.raw.get("spec_text_sample") or "")
        spec_parts: list[str] = []
        if spec_services:
            spec_parts.append("Извлечённые AI услуги из технической спецификации:")
            spec_parts.append(json.dumps(spec_services, ensure_ascii=False)[:8000])
        if isinstance(spec_summary, dict):
            spec_parts.append("Структурированная выжимка технической спецификации:")
            spec_parts.append(json.dumps(spec_summary, ensure_ascii=False)[:8000])
        if spec_text_sample:
            spec_parts.append("Фрагмент текста технической спецификации:")
            spec_parts.append(spec_text_sample[:10000])

        text = "\n".join(
            part for part in [
                f"Источник: {lot.source}",
                f"ID: {lot.external_id}",
                f"Название: {lot.title}",
                f"Описание: {lot.description}",
                f"Заказчик: {lot.customer_name or lot.organizer_name or ''}",
                f"Тип закупки: {lot.purchase_type or ''}",
                f"Место: {lot.place or ''}",
                f"Сумма: {lot.amount or ''}",
                "Дополнительный текст:",
                "\n".join(raw_parts),
                "\n".join(spec_parts),
            ] if part
        )
        return text[:24000]

    def _parse_json(self, content: str) -> dict[str, Any]:
        try:
            value = json.loads(content)
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", content, flags=re.DOTALL)
            if not match:
                return {}
            try:
                value = json.loads(match.group(0))
                return value if isinstance(value, dict) else {}
            except json.JSONDecodeError:
                return {}

    def _normalize_score(self, value: Any) -> int:
        try:
            score = int(float(value))
        except (TypeError, ValueError):
            return 0
        return max(0, min(100, score))
