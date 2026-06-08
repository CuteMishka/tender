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
        provider: str = "groq",
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.min_score = min_score
        self.company_profile = (company_profile or "").strip()
        self.context_keywords = context_keywords
        self.provider = (provider or "groq").strip().lower()

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def analyze(self, lot: TenderLot) -> dict[str, Any]:
        if not self.enabled:
            key_name = "GEMINI_API_KEY" if self.provider == "gemini" else "GROQ_API_KEY"
            return {"score": 0, "passed": False, "reason": f"{key_name} is not configured"}
        if self.provider == "gemini":
            return self._analyze_gemini(lot)
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": self._user_prompt(lot)},
            ],
        }
        if not self._is_local_openai_compatible():
            payload["response_format"] = {"type": "json_object"}
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
        result["provider"] = self.provider_name
        result["model"] = self.model
        return result

    def _analyze_gemini(self, lot: TenderLot) -> dict[str, Any]:
        payload = {
            "system_instruction": {
                "parts": [{"text": self._system_prompt()}],
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": self._user_prompt(lot)}],
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }
        model = self.model
        if model.startswith("models/"):
            model = model.removeprefix("models/")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        content = self._gemini_text(data)
        result = self._parse_json(content)
        score = self._normalize_score(result.get("score"))
        result["score"] = score
        result["passed"] = score >= self.min_score and bool(result.get("is_suitable", score >= self.min_score))
        result["provider"] = self.provider_name
        result["model"] = self.model
        return result

    @property
    def provider_name(self) -> str:
        if self.provider == "gemini":
            return "gemini"
        if self._is_local_openai_compatible():
            return "local-llm"
        return "groq"

    def _is_local_openai_compatible(self) -> bool:
        normalized = self.base_url.lower()
        return "11434" in normalized or "ollama" in normalized or "localhost" in normalized or "127.0.0.1" in normalized

    def _system_prompt(self) -> str:
        keywords = ", ".join(self.context_keywords)
        return (
            "You select public procurement tenders for Freedom Cloud. "
            "Freedom Cloud fits cloud infrastructure, IaaS/PaaS/SaaS, VPS/VDS, dedicated servers, "
            "data centers, colocation, virtualization, Kubernetes, Linux/server administration, "
            "storage, backup/DR, network equipment, firewalls, WAF, SIEM/SOC and IT security. "
            "Reject household goods, stationery, food, medicine, construction, furniture, chemicals, "
            "industrial equipment and other non-IT infrastructure tenders. "
            f"Use these context hints for semantic matching only: {keywords}. "
            "Return only compact JSON: "
            "{\"is_suitable\": boolean, \"score\": 0-100, \"matched_theme\": string, \"reason\": string, \"keywords\": [string], \"spec_context_used\": boolean}."
        )
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
            f"Базовые контекстные слова: {keywords}. "
            "Эти слова являются только подсказками для семантической оценки, а не правилом точного совпадения. "
            "Ответь только JSON объектом: "
            "{\"is_suitable\": boolean, \"score\": 0-100, \"matched_theme\": string, \"reason\": string, \"keywords\": [string], \"spec_context_used\": boolean}."
        )

    def _user_prompt(self, lot: TenderLot) -> str:
        if lot.source == "tenderplus":
            ai_context_keywords = lot.raw.get("ai_context_keywords")
            keyword_context = ""
            if isinstance(ai_context_keywords, list):
                values = [str(item).strip() for item in ai_context_keywords if str(item).strip()]
                keyword_context = ", ".join(values[:80])
            spec_summary = lot.raw.get("spec_summary")
            spec_services = lot.raw.get("spec_services")
            spec_text_sample = str(lot.raw.get("spec_text_sample") or "")
            spec_parts: list[str] = []
            if spec_services:
                spec_parts.append("Document services extracted by local analyzer:")
                spec_parts.append(json.dumps(spec_services, ensure_ascii=False)[:8000])
            if isinstance(spec_summary, dict):
                spec_parts.append("Structured technical specification summary:")
                spec_parts.append(json.dumps(spec_summary, ensure_ascii=False)[:8000])
            if spec_text_sample:
                spec_parts.append("Technical specification/document text:")
                spec_parts.append(spec_text_sample[:10000])
            text = "\n".join(
                part
                for part in [
                    f"Source: {lot.source}",
                    f"Published platform: {lot.raw.get('published_platform') or lot.raw.get('source_label') or ''}",
                    f"ID: {lot.external_id}",
                    f"Title: {lot.title}",
                    f"Description: {lot.description}",
                    f"Customer: {lot.customer_name or lot.organizer_name or ''}",
                    f"Purchase type: {lot.purchase_type or ''}",
                    f"Place: {lot.place or ''}",
                    f"Amount: {lot.amount or ''}",
                    f"Dictionary hints: {keyword_context}",
                    f"Extra text: {lot.raw.get('match_text') or ''}",
                    "\n".join(spec_parts),
                ]
                if part
            )
            return text[:24000]
        raw_parts = [
            str(lot.raw.get("match_text") or ""),
            str(lot.raw.get("announce_title") or ""),
            str(lot.raw.get("row_text") or ""),
            str(lot.raw.get("detail_text_sample") or ""),
        ]
        spec_summary = lot.raw.get("spec_summary")
        spec_services = lot.raw.get("spec_services")
        spec_text_sample = str(lot.raw.get("spec_text_sample") or "")
        ai_context_keywords = lot.raw.get("ai_context_keywords")
        keyword_context = ""
        if isinstance(ai_context_keywords, list):
            values = [str(item).strip() for item in ai_context_keywords if str(item).strip()]
            keyword_context = ", ".join(values[:80])
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
                f"Ключевые слова из справочника для семантической ориентации AI: {keyword_context}",
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

    def _gemini_text(self, data: dict[str, Any]) -> str:
        parts: list[str] = []
        for candidate in data.get("candidates") or []:
            content = candidate.get("content") if isinstance(candidate, dict) else None
            if not isinstance(content, dict):
                continue
            for part in content.get("parts") or []:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    parts.append(part["text"])
        return "\n".join(parts)

    def _normalize_score(self, value: Any) -> int:
        try:
            score = int(float(value))
        except (TypeError, ValueError):
            return 0
        return max(0, min(100, score))
