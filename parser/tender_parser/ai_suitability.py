import json
import re
from typing import Any

import httpx

from tender_parser.schemas import TenderLot

TENDER_SERVICE_PROFILE = (
    "OpenNebula; VMware; виртуальный ЦОД/VDC/VPC; Private Tender; IaaS; VPS/VDS; выделенные и виртуальные серверы; "
    "аренда серверов, серверных и вычислительных мощностей; vCPU, vRAM, vHDD, vSSD; SAP/ERP infrastructure; "
    "ЦОД/дата-центр/центр обработки данных; colocation/co-location; аренда стойко-мест; размещение оборудования; "
    "гермозона; СХД; хранение данных; Backup/BaaS; резервное копирование; DRaaS; аварийное восстановление; "
    "защищенные каналы/VPN; firewall; техническая поддержка облачной инфраструктуры; информационная безопасность; "
    "кибербезопасность; SOC/ОЦИБ; SIEM; DLP; EDR/XDR; NGFW/FortiGate/Fortinet; защита от DDoS и внешних кибератак; "
    "аудит безопасности; пентест; тестирование на проникновение; СКЗИ; криптозащита; антивирусная защита."
)

INFOSEC_RELEVANCE_TERMS = (
    "информационная безопасность",
    "информационной безопасности",
    "обеспечение информационной безопасности",
    "обеспечению информационной безопасности",
    "услуга информационной безопасности",
    "услуги информационной безопасности",
    "кибербезопасность",
    "кибербезопасности",
    "кибератак",
    "кибератаки",
    "защита от внешних кибератак",
    "защита от ddos",
    "ddos",
    "soc",
    "оц иб",
    "оциб",
    "siem",
    "dlp",
    "edr",
    "xdr",
    "soar",
    "ngfw",
    "fortigate",
    "fortinet",
    "zero trust",
    "threat intelligence",
    "аудит безопасности",
    "аудиту безопасности",
    "пентест",
    "тестирование на проникновение",
    "тестированию на проникновение",
    "антивирус",
    "антивирусная защита",
    "скзи",
    "криптозащита",
    "межсетевой экран",
    "firewall",
    "система расширенного обнаружения",
    "защиты конечных устройств",
)

SECURITY_SERVICE_REVIEW_TERMS = (
    "услуги по обеспечению безопасности",
    "услуга по обеспечению безопасности",
    "обеспечение безопасности",
    "обеспечению безопасности",
    "обеспечения безопасности",
)

PHYSICAL_SECURITY_NEGATIVE_TERMS = (
    "физической охран",
    "охранные услуги",
    "охранных услуг",
    "услуги охраны",
    "услуги по охране",
    "охрана объект",
    "охраны объект",
    "пост охраны",
    "пропускной режим",
    "тревожная кноп",
    "охранной сигнализации",
    "пожарн",
    "видеонаблюд",
    "видеокамер",
    "скуд",
)

GOODS_NEGATIVE_TERMS = (
    "станок",
    "видеопроектор",
    "проектор",
    "dlp-проектор",
    "кабель-канал",
    "кабель",
    "модем",
    "маршрутизатор",
    "коммутатор",
    "принтер",
    "сканер",
    "монитор",
    "компьютер",
    "ноутбук",
    "планшет",
    "камера",
    "видеокамер",
    "видеорегистратор",
    "оборудование",
    "запчаст",
    "картридж",
    "шкаф",
    "мебель",
    "канюл",
    "катетер",
    "медицин",
    "реагент",
    "раствор",
    "кардиостим",
    "презерватив",
    "викрил",
)

CONTEXT_NOISE_TERMS = (
    "научно-технической обработке документов",
    "научно технической обработке документов",
    "обработке документов",
    "упорядочивания документов",
    "экспертизе образовательных программ",
    "образовательных программ",
    "по специальности",
    "учебн",
)

STRONG_SPEC_RELEVANCE_TERMS = (
    "opennebula",
    "vmware",
    "private tender",
    "tender services",
    "iaas",
    "vps",
    "vds",
    "vdc",
    "vpc",
    "vcpu",
    "vram",
    "vhdd",
    "vssd",
    "sap",
    "erp",
    "backup",
    "baas",
    "draas",
    "colocation",
    "co-location",
    "виртуальный цод",
    "виртуалды data",
    "виртуалды деректер",
    "виртуальная машина",
    "виртуалды машина",
    "виртуальных машин",
    "виртуальные вычислительные",
    "виртуалды есептеу",
    "облачн",
    "бұлтты",
    "аренда вычисл",
    "аренду вычисл",
    "вычислительных мощностей",
    "есептеу қуат",
    "серверде ақпарат",
    "дата-центр",
    "центр обработки данных",
    "цод",
    "дбо",
    "деректерді өңдеу орталығы",
    "схд",
    "хранение данных",
    "сақтық көшір",
    "резервное копирование",
    "резервтік көші",
    "гермозон",
    "стойко-мест",
    *INFOSEC_RELEVANCE_TERMS,
)

CORE_SPEC_POSITIVE_TERMS = (
    "private tender",
    "iaas",
    "vdc",
    "vpc",
    "vcpu",
    "vram",
    "vhdd",
    "vssd",
    "виртуальный цод",
    "виртуальный дата",
    "виртуалды data",
    "виртуалды деректер орталы",
    "виртуалды есептеу",
    "виртуальная машина",
    "виртуалды машина",
    "виртуальных машин",
    "виртуальные вычислительные",
    "виртуальный сервер",
    "виртуального выделенного сервера",
    "выделенный сервер",
    "облачный сервер",
    "бұлтты сервер",
    "vps",
    "vds",
    "аренда вычисл",
    "аренду вычисл",
    "вычислительных мощностей",
    "физического размещения информации на сервере",
    "есептеу қуат",
    "серверде ақпарат",
    "информационная безопасность",
    "информационной безопасности",
    "обеспечение информационной безопасности",
    "обеспечению информационной безопасности",
    "кибербезопасность",
    "кибербезопасности",
    "soc",
    "оциб",
    "siem",
    "dlp",
    "edr",
    "xdr",
    "ngfw",
    "fortigate",
    "fortinet",
)

SUPPORTING_SPEC_POSITIVE_TERMS = (
    "opennebula",
    "vmware",
    "sap",
    "erp",
    "hosting",
    "хостинг",
    "backup",
    "baas",
    "draas",
    "резервное копирование",
    "резервтік көші",
    "сақтық көшір",
    "схд",
    "хранение данных",
    "дискілік кеңістік",
    "дата-центр",
    "центр обработки данных",
    "цод",
    "дбо",
    "деректерді өңдеу орталығы",
    "colocation",
    "co-location",
    "гермозон",
    "vpn",
    "firewall",
    "zero trust",
    "threat intelligence",
    "защита от внешних кибератак",
    "кибератак",
    "ddos",
    "пентест",
    "тестирование на проникновение",
    "тестированию на проникновение",
    "аудит безопасности",
    "аудиту безопасности",
    "антивирус",
    "скзи",
    "криптозащита",
    "межсетевой экран",
)

NEGATIVE_SPEC_TERMS = (
    "канцеляр",
    "полиграф",
    "видеокамер",
    "видеорегистратор",
    "компьютер специализированный",
    "рабочая станция",
    "мебель",
    "труба",
    "реагент",
    "медицин",
    "продукт",
    "пожарн",
    "охранной сигнализации",
    "zoom",
    "домен",
    "oracle license",
)

SPEC_RELEVANCE_TERMS = (
    *STRONG_SPEC_RELEVANCE_TERMS,
    "opennebula",
    "vmware",
    "virtual tender",
    "private tender",
    "tender services",
    "iaas",
    "vps",
    "vds",
    "vdc",
    "vpc",
    "vcpu",
    "vram",
    "vhdd",
    "vssd",
    "sap",
    "erp",
    "backup",
    "baas",
    "draas",
    "colocation",
    "co-location",
    "storage",
    "data center",
    "виртуальный цод",
    "виртуальный дата",
    "виртуалды data",
    "виртуалды деректер",
    "виртуалды машина",
    "виртуальная машина",
    "виртуальных машин",
    "виртуальные вычислительные",
    "виртуалды есептеу",
    "облачн",
    "бұлтты",
    "iaas",
    "сервер",
    "серверде ақпарат",
    "аренда сервер",
    "аренду сервер",
    "аренда вычисл",
    "вычислительных мощностей",
    "есептеу қуат",
    "дата-центр",
    "центр обработки данных",
    "цод",
    "дбо",
    "деректерді өңдеу орталығы",
    "дискілік кеңістік",
    "схд",
    "хранение данных",
    "сақтық көшір",
    "резерв",
    "гермозон",
    "стойко-мест",
    "vpn",
    "firewall",
    *INFOSEC_RELEVANCE_TERMS,
)


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
        require_spec_text: bool = True,
        spec_text_max_chars: int = 20000,
        prompt_max_chars: int = 18000,
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.min_score = min_score
        self.company_profile = (company_profile or "").strip()
        self.context_keywords = context_keywords
        self.provider = (provider or "groq").strip().lower()
        self.require_spec_text = require_spec_text
        self.spec_text_max_chars = spec_text_max_chars
        self.prompt_max_chars = prompt_max_chars

    @property
    def enabled(self) -> bool:
        return bool(self.api_key) or self._is_local_openai_compatible()

    def analyze(self, lot: TenderLot) -> dict[str, Any]:
        if not self.enabled:
            key_name = "GEMINI_API_KEY" if self.provider == "gemini" else "GROQ_API_KEY"
            return {"score": 0, "passed": False, "reason": f"{key_name} is not configured"}
        hard_negative = self._hard_negative_result(lot)
        if hard_negative is not None:
            return hard_negative
        if self.provider == "gemini":
            return self._analyze_gemini(lot)
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "max_tokens": 350,
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
        result, score = self._apply_deterministic_spec_fallback(lot, result, score)
        result, score = self._apply_deterministic_card_fallback(lot, result, score)
        if self.require_spec_text and not self._has_spec_context(lot):
            score = min(score, self.min_score)
            result["is_suitable"] = False
            result["reason"] = self._append_reason(result.get("reason"), "Техническая спецификация не была прочитана.")
        result["score"] = score
        result["passed"] = score > self.min_score and bool(result.get("is_suitable", score > self.min_score))
        result["provider"] = self.provider_name
        result["model"] = self.model
        return result

    def deterministic_fallback(self, lot: TenderLot) -> dict[str, Any] | None:
        """Conservatively classify a lot when the configured LLM is unavailable.

        A read technical specification always takes precedence over the shorter
        card text.  Card-only promotion is allowed only when the deployment is
        explicitly configured to evaluate lots without a specification.
        """
        result = self._hard_negative_result(lot)
        fallback_source = "hard_negative"
        has_spec_context = self._has_spec_context(lot)
        if result is None and has_spec_context:
            result = self._deterministic_spec_result(lot)
            fallback_source = "spec"
        if result is None and not self.require_spec_text:
            result = self._deterministic_card_result(lot)
            fallback_source = "card"
        if result is None:
            return None

        normalized = dict(result)
        score = self._normalize_score(normalized.get("score"))
        is_suitable = bool(normalized.get("is_suitable"))
        normalized["score"] = score
        normalized["passed"] = score > self.min_score and is_suitable
        normalized["provider"] = self.provider_name
        normalized["model"] = self.model
        normalized["deterministic_fallback"] = True
        normalized["fallback_source"] = fallback_source
        return normalized

    def _analyze_gemini(self, lot: TenderLot) -> dict[str, Any]:
        hard_negative = self._hard_negative_result(lot)
        if hard_negative is not None:
            return hard_negative
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
                "maxOutputTokens": 350,
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
        result, score = self._apply_deterministic_spec_fallback(lot, result, score)
        result, score = self._apply_deterministic_card_fallback(lot, result, score)
        if self.require_spec_text and not self._has_spec_context(lot):
            score = min(score, self.min_score)
            result["is_suitable"] = False
            result["reason"] = self._append_reason(result.get("reason"), "Техническая спецификация не была прочитана.")
        result["score"] = score
        result["passed"] = score > self.min_score and bool(result.get("is_suitable", score > self.min_score))
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

    def _hard_negative_result(self, lot: TenderLot) -> dict[str, Any] | None:
        subject_type = str(lot.raw.get("subject_type") or lot.purchase_type or "").lower()
        text = " ".join(
            str(value or "")
            for value in [
                lot.title,
                lot.description,
                lot.purchase_type,
                lot.customer_name,
                lot.organizer_name,
                lot.raw.get("match_text"),
                lot.raw.get("enstru_title"),
                lot.raw.get("enstru_description"),
            ]
        ).lower()
        if subject_type and "товар" in subject_type:
            return self._negative_result("Лот является поставкой товара, а не услугой из профиля Tender.")
        has_service_context = self._has_high_confidence_service_context(text)
        if any(term in text for term in GOODS_NEGATIVE_TERMS) and not has_service_context:
            return self._negative_result("В тексте найдены признаки поставки оборудования или расходных материалов без услуги из профиля Tender.")
        if any(term in text for term in CONTEXT_NOISE_TERMS) and not has_service_context:
            return self._negative_result("Лот относится к документам, обучению или образовательным программам, а не к инфраструктуре/ИБ-услугам Tender.")
        return None

    def _negative_result(self, reason: str) -> dict[str, Any]:
        return {
            "is_suitable": False,
            "score": 0,
            "passed": False,
            "matched_theme": "Нерелевантный товар/услуга",
            "reason": reason,
            "required_services": [],
            "positive_reasons": [],
            "negative_reasons": [reason],
            "recommendation": "Не добавлять в Подходящие.",
            "keywords": [],
            "spec_context_used": False,
            "spec_evidence": "",
            "provider": self.provider_name,
            "model": self.model,
            "deterministic_reject": True,
        }

    def _has_high_confidence_service_context(self, text: str) -> bool:
        service_phrases = (
            "услуги по обеспечению информационной безопасности",
            "услуга информационной безопасности",
            "услуги информационной безопасности",
            "кибербезопасность",
            "кибербезопасности",
            "тестирование на проникновение",
            "тестированию на проникновение",
            "пентест",
            "защита от ddos",
            "защита от внешних кибератак",
            "аудит безопасности",
            "аудиту безопасности",
            "услуги по аренде виртуального",
            "аренда виртуаль",
            "предоставление вычислительных мощностей",
            "вычислительных мощностей",
            "физического размещения информации на сервере",
            "виртуальный цод",
            "хостинг",
            "colocation",
            "co-location",
            "стойко-мест",
            "центр обработки данных",
            "резервное копирование",
        )
        return any(phrase in text for phrase in service_phrases)

    def _system_prompt(self) -> str:
        keywords = ", ".join(self.context_keywords)
        spec_rule = (
            "Если техническая спецификация или ее релевантный фрагмент не прочитаны, ставь is_suitable=false и score <= 50. "
            if self.require_spec_text
            else (
                "Если техническая спецификация не прочитана, оцени по карточке лота, названию, описанию, заказчику, "
                "типу закупки и контексту TenderPlus; не отклоняй автоматически только из-за отсутствия ТС, но снижай "
                "уверенность и явно укажи, что специалист должен проверить полную ТС. "
            )
        )
        return (
            "Ты эксперт по государственным закупкам, облачной IT-инфраструктуре и информационной безопасности. "
            "Оценивай, подходит ли тендер компании Tender, в первую очередь по технической спецификации. "
            f"Профиль услуг Tender: {self.company_profile or TENDER_SERVICE_PROFILE}. "
            f"Типовые релевантные услуги из эталонных ТС: {TENDER_SERVICE_PROFILE}. "
            "Подходящими являются закупки аренды виртуальных вычислительных ресурсов, VDC/виртуального ЦОД, IaaS, "
            "Private Tender, VPS/VDS, выделенных серверов как услуги, серверных или вычислительных мощностей, "
            "размещения оборудования в ЦОД, colocation, СХД/хранения данных, backup/BaaS, DRaaS, аварийного "
            "восстановления, защищенных каналов и поддержки такой облачной инфраструктуры. Также подходящими являются "
            "услуги информационной безопасности и кибербезопасности: SOC/ОЦИБ, SIEM, DLP, EDR/XDR, NGFW/FortiGate, "
            "защита от DDoS и внешних кибератак, аудит безопасности, пентест, тестирование на проникновение, СКЗИ, "
            "криптозащита, антивирусная защита и сопровождение средств защиты информации. "
            "Обычная поставка компьютеров, камер, офисной техники, мебели, стройки, медицины, продуктов, канцелярии, "
            "разовых лицензий или физического оборудования без облачной/дата-центровой услуги либо без услуги "
            "информационной безопасности не подходит. "
            "Слово 'сервер' само по себе не достаточно: проверь, требуется ли именно услуга аренды/предоставления/"
            "размещения/поддержки серверной или облачной инфраструктуры. "
            f"{spec_rule}"
            "Если ТС прочитана, используй ее сильнее, чем краткое название лота или ключевые слова. "
            f"Контекстные слова для семантической ориентации: {keywords}. "
            "Оценивай смысл, включая русский и казахский текст, а не только точные совпадения. "
            "В поле required_services выпиши услуги/работы, которые реально требуются по ТС лота. "
            "В positive_reasons перечисли аргументы, почему лот может подходить Tender. "
            "В negative_reasons перечисли аргументы, почему лот может не подходить или почему отклонён. "
            "reason должен быть развернутым, понятным человеку и без внутренних технических кодов. "
            "Ответь только JSON объектом: "
            "{\"is_suitable\": boolean, \"score\": 0-100, \"matched_theme\": string, \"reason\": string, "
            "\"required_services\": [string], \"positive_reasons\": [string], \"negative_reasons\": [string], "
            "\"recommendation\": string, \"keywords\": [string], \"spec_context_used\": boolean, \"spec_evidence\": string}."
        )

    def _user_prompt(self, lot: TenderLot) -> str:
        spec_parts = self._spec_prompt_parts(lot)
        if lot.source == "tenderplus":
            ai_context_keywords = lot.raw.get("ai_context_keywords")
            keyword_context = ""
            if isinstance(ai_context_keywords, list):
                values = [str(item).strip() for item in ai_context_keywords if str(item).strip()]
                keyword_context = ", ".join(values[:80])
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
            return text[: self.prompt_max_chars]
        raw_parts = [
            str(lot.raw.get("match_text") or ""),
            str(lot.raw.get("announce_title") or ""),
            str(lot.raw.get("row_text") or ""),
            str(lot.raw.get("detail_text_sample") or ""),
        ]
        ai_context_keywords = lot.raw.get("ai_context_keywords")
        keyword_context = ""
        if isinstance(ai_context_keywords, list):
            values = [str(item).strip() for item in ai_context_keywords if str(item).strip()]
            keyword_context = ", ".join(values[:80])

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
        return text[: self.prompt_max_chars]

    def _spec_prompt_parts(self, lot: TenderLot) -> list[str]:
        spec_summary = lot.raw.get("spec_summary")
        spec_services = lot.raw.get("spec_services")
        spec_text_sample = str(lot.raw.get("spec_text_sample") or "")
        spec_status = str(lot.raw.get("spec_processing_status") or "")
        spec_doc_name = str(lot.raw.get("spec_document_name") or "")
        spec_chars = lot.raw.get("spec_text_chars")
        spec_requirement = (
            "Требование к решению: финальная оценка должна опираться на прочитанную техническую спецификацию."
            if self.require_spec_text
            else "Техническая спецификация повышает точность; если она не прочитана, оцени доступную карточку и отметь необходимость ручной проверки ТС."
        )
        parts = [
            spec_requirement,
            f"Статус чтения ТС: {spec_status or 'unknown'}",
            f"Документ ТС: {spec_doc_name or 'не определен'}",
            f"Символов извлечено из ТС: {spec_chars or 0}",
        ]
        if spec_services:
            parts.append("Извлеченные услуги/требования из ТС:")
            parts.append(json.dumps(spec_services, ensure_ascii=False)[:4000])
        if isinstance(spec_summary, dict):
            parts.append("Структурированная выжимка ТС:")
            parts.append(json.dumps(spec_summary, ensure_ascii=False)[:4000])
        if spec_text_sample:
            signals = self._detect_service_signals(spec_text_sample)
            parts.append(f"Локально найденные инфраструктурные сигналы в ТС: {', '.join(signals) if signals else 'не найдены'}")
            parts.append("Релевантные фрагменты ТС для семантической оценки:")
            parts.append(self._relevant_spec_excerpt(spec_text_sample, max_chars=self.spec_text_max_chars))
        else:
            if self.require_spec_text:
                parts.append("Текст ТС не прочитан. Такой лот нельзя считать подходящим.")
            else:
                parts.append("Текст ТС не прочитан. Оцени карточку лота и укажи, что полную ТС нужно проверить вручную.")
        return parts

    def _has_spec_context(self, lot: TenderLot) -> bool:
        return bool(str(lot.raw.get("spec_text_sample") or "").strip()) or isinstance(lot.raw.get("spec_summary"), dict)

    def _detect_service_signals(self, text: str) -> list[str]:
        lowered = text.lower()
        result: list[str] = []
        for term in SPEC_RELEVANCE_TERMS:
            if term in lowered and term not in result:
                result.append(term)
            if len(result) >= 24:
                break
        return result

    def _relevant_spec_excerpt(self, text: str, max_chars: int) -> str:
        clean = re.sub(r"[ \t]+", " ", text).strip()
        if len(clean) <= max_chars:
            return clean
        lowered = clean.lower()
        windows: list[tuple[int, int]] = []
        for term in SPEC_RELEVANCE_TERMS:
            start = 0
            while True:
                idx = lowered.find(term, start)
                if idx < 0:
                    break
                windows.append((max(0, idx - 700), min(len(clean), idx + len(term) + 1400)))
                start = idx + len(term)
                if len(windows) >= 24:
                    break
            if len(windows) >= 24:
                break
        if not windows:
            return clean[:max_chars]
        windows.sort()
        merged: list[tuple[int, int]] = []
        for start, end in windows:
            if not merged or start > merged[-1][1] + 200:
                merged.append((start, end))
            else:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        excerpts: list[str] = []
        used = 0
        for start, end in merged:
            fragment = clean[start:end].strip()
            if not fragment:
                continue
            available = max_chars - used
            if available <= 0:
                break
            if len(fragment) > available:
                fragment = fragment[:available]
            excerpts.append(fragment)
            used += len(fragment) + 5
        return "\n---\n".join(excerpts)[:max_chars]

    def _append_reason(self, reason: Any, suffix: str) -> str:
        text = str(reason or "").strip()
        return f"{text} {suffix}".strip()

    def _apply_deterministic_spec_fallback(self, lot: TenderLot, result: dict[str, Any], score: int) -> tuple[dict[str, Any], int]:
        if not self.require_spec_text or not self._has_spec_context(lot):
            return result, score
        fallback = self._deterministic_spec_result(lot)
        if fallback is None:
            return result, score
        is_suitable_value = result.get("is_suitable")
        parsed_boolean = isinstance(is_suitable_value, bool)
        if score > self.min_score and parsed_boolean:
            return result, score
        merged = {**result, **fallback}
        return merged, max(score, int(fallback["score"]))

    def _apply_deterministic_card_fallback(self, lot: TenderLot, result: dict[str, Any], score: int) -> tuple[dict[str, Any], int]:
        if score > self.min_score and isinstance(result.get("is_suitable"), bool):
            return result, score
        fallback = self._deterministic_card_result(lot)
        if fallback is None:
            return result, score
        merged = {**result, **fallback}
        return merged, max(score, int(fallback["score"]))

    def _deterministic_spec_result(self, lot: TenderLot) -> dict[str, Any] | None:
        spec_text = str(lot.raw.get("spec_text_sample") or "").lower()
        if not spec_text:
            return None
        infosec = self._deterministic_infosec_result(lot, spec_text, spec_context=True)
        if infosec is not None:
            return infosec
        title_text = f"{lot.title} {lot.description}".lower()
        core = self._terms_present(spec_text, CORE_SPEC_POSITIVE_TERMS)
        support = self._terms_present(spec_text, SUPPORTING_SPEC_POSITIVE_TERMS)
        negatives = self._terms_present(f"{title_text} {spec_text[:2000]}", NEGATIVE_SPEC_TERMS)
        if not core:
            return None
        high_confidence_core = any(
            term in core
            for term in (
                "vdc",
                "iaas",
                "private tender",
                "виртуальный цод",
                "виртуалды data",
                "виртуалды деректер орталы",
                "виртуалды есептеу",
                "виртуальный сервер",
                "виртуального выделенного сервера",
                "выделенный сервер",
                "vps",
                "vds",
                "вычислительных мощностей",
                "физического размещения информации на сервере",
                "есептеу қуат",
                "серверде ақпарат",
            )
        )
        if not high_confidence_core and len(core) < 2:
            return None
        if negatives and len(core) < 2 and len(support) < 3:
            return None
        if len(support) < 1 and len(core) < 2:
            return None
        score = 95 if len(core) >= 3 and len(support) >= 2 else 80
        evidence = ", ".join([*core[:8], *support[:8]])
        return {
            "is_suitable": True,
            "score": score,
            "matched_theme": "Виртуальный ЦОД / IaaS / вычислительные мощности",
            "reason": (
                "Лот подходит Tender: в ТС явно запрошены услуги виртуального ЦОД, IaaS/"
                f"вычислительных мощностей или близкой облачной инфраструктуры. Найденные признаки: {evidence}."
            ),
            "required_services": self._fallback_required_services(core, support),
            "positive_reasons": [
                "ТС содержит признаки аренды или предоставления виртуальных вычислительных ресурсов.",
                "Требования пересекаются с профилем Tender: облачная инфраструктура, серверные ресурсы, ЦОД, хранение данных или резервное копирование.",
            ],
            "negative_reasons": [],
            "recommendation": "Добавить в Подходящие и проверить коммерческие условия, сроки, регион и требования к сертификации.",
            "keywords": [*core[:8], *support[:8]],
            "spec_context_used": True,
            "spec_evidence": evidence,
            "deterministic_fallback": True,
        }

    def _deterministic_card_result(self, lot: TenderLot) -> dict[str, Any] | None:
        card_text = " ".join(
            str(value or "")
            for value in [
                lot.title,
                lot.description,
                lot.purchase_type,
                lot.customer_name,
                lot.organizer_name,
                lot.raw.get("match_text"),
            ]
        ).lower()
        if not card_text.strip():
            return None
        infosec = self._deterministic_infosec_result(lot, card_text, spec_context=bool(self._has_spec_context(lot)))
        if infosec is not None:
            return infosec
        card_core_terms = (
            *CORE_SPEC_POSITIVE_TERMS,
            "colocation",
            "co-location",
            "стойко-мест",
            "хранение данных",
            "схд",
            "центр обработки данных",
            "цод",
        )
        core = self._terms_present(card_text, card_core_terms)
        support = self._terms_present(card_text, SUPPORTING_SPEC_POSITIVE_TERMS)
        negatives = self._terms_present(card_text, NEGATIVE_SPEC_TERMS)
        if not core:
            return None
        high_confidence_core = any(
            term in core
            for term in (
                "vdc",
                "iaas",
                "private tender",
                "виртуальный цод",
                "виртуалды data",
                "виртуалды деректер орталы",
                "виртуалды есептеу",
                "виртуальный сервер",
                "виртуального выделенного сервера",
                "выделенный сервер",
                "vps",
                "vds",
                "вычислительных мощностей",
                "физического размещения информации на сервере",
                "есептеу қуат",
                "серверде ақпарат",
                "co-location",
                "colocation",
            )
        )
        if not high_confidence_core and len(core) < 2:
            return None
        if negatives and len(core) < 2 and len(support) < 2:
            return None
        if len(support) < 1 and len(core) < 2:
            return None
        score = 90 if len(core) >= 3 and len(support) >= 1 else 80
        evidence = ", ".join([*core[:8], *support[:8]])
        return {
            "is_suitable": True,
            "score": score,
            "matched_theme": "Облачная инфраструктура / хостинг / colocation",
            "reason": (
                "Карточка лота уже содержит сильные признаки облачной или дата-центровой услуги. "
                f"Найденные признаки: {evidence}."
            ),
            "required_services": self._fallback_required_services(core, support),
            "positive_reasons": [
                "В карточке есть признаки серверной, облачной или colocation-инфраструктуры.",
                "Текст совпадает с профилем Tender по вычислительным мощностям, хранению данных или размещению оборудования.",
            ],
            "negative_reasons": [],
            "recommendation": "Добавить в Подходящие и проверить полную ТС, сроки и коммерческие условия.",
            "keywords": [*core[:8], *support[:8]],
            "spec_context_used": bool(self._has_spec_context(lot)),
            "spec_evidence": evidence,
            "deterministic_fallback": True,
        }

    def _deterministic_infosec_result(self, lot: TenderLot, text: str, spec_context: bool) -> dict[str, Any] | None:
        lower_text = text.lower()
        found = self._terms_present(lower_text, INFOSEC_RELEVANCE_TERMS)
        review_terms = [] if found else self._terms_present(lower_text, SECURITY_SERVICE_REVIEW_TERMS)
        if not found and not review_terms:
            return None
        title_text = f"{lot.title} {lot.description} {lot.purchase_type or ''}".lower()
        negatives = self._terms_present(title_text, NEGATIVE_SPEC_TERMS)
        if negatives and not any(term in found for term in ("информационная безопасность", "информационной безопасности", "кибербезопасность", "soc", "siem", "dlp", "fortigate", "fortinet")):
            return None
        physical_security = self._terms_present(title_text, PHYSICAL_SECURITY_NEGATIVE_TERMS)
        if review_terms and physical_security:
            return None
        if review_terms:
            evidence = ", ".join(review_terms[:6])
            return {
                "is_suitable": False,
                "score": 50,
                "matched_theme": "Безопасность / требуется уточнение ИБ",
                "reason": (
                    "Карточка содержит услуги по обеспечению безопасности, но без явных признаков физической охраны. "
                    "Лот не скрыт как 0%, требуется ручная проверка, относится ли он к информационной безопасности."
                ),
                "required_services": ["Информационная безопасность (уточнить по ТС)"],
                "positive_reasons": ["Найдена формулировка услуг по обеспечению безопасности."],
                "negative_reasons": ["Нет явного указания на ИБ/кибербезопасность в карточке."],
                "recommendation": "Оставить во вкладке Все и проверить ТС вручную; в Подходящие добавлять только при подтверждении ИБ.",
                "keywords": review_terms[:6],
                "spec_context_used": spec_context,
                "spec_evidence": evidence,
                "deterministic_fallback": True,
            }
        score = 88 if spec_context else 75
        evidence = ", ".join(found[:10])
        return {
            "is_suitable": True,
            "score": score,
            "matched_theme": "Информационная безопасность / кибербезопасность",
            "reason": (
                "Лот подходит профилю Tender по направлению информационной безопасности: "
                f"найдены признаки {evidence}."
            ),
            "required_services": self._fallback_required_services(found, []),
            "positive_reasons": [
                "Текст содержит явные признаки услуг информационной безопасности или кибербезопасности.",
                "Направление пересекается с профилем Tender: SOC/ОЦИБ, SIEM, DLP, NGFW, защита от кибератак, аудит или сопровождение средств защиты.",
            ],
            "negative_reasons": [],
            "recommendation": "Добавить в Подходящие при подтверждении сроков, требований к сертификации и состава услуг в ТС.",
            "keywords": found[:12],
            "spec_context_used": spec_context,
            "spec_evidence": evidence,
            "deterministic_fallback": True,
        }

    def _terms_present(self, text: str, terms: tuple[str, ...]) -> list[str]:
        found: list[str] = []
        for term in terms:
            if self._term_present(text, term) and term not in found:
                found.append(term)
        return found

    def _term_present(self, text: str, term: str) -> bool:
        if term in {"soc", "siem", "dlp", "edr", "xdr", "soar", "ngfw"}:
            return re.search(rf"(?<![a-zа-я0-9]){re.escape(term)}(?![a-zа-я0-9])", text, flags=re.IGNORECASE) is not None
        return term in text

    def _fallback_required_services(self, core: list[str], support: list[str]) -> list[str]:
        terms = [*core, *support]
        services: list[str] = []
        checks = [
            (("vdc", "виртуальный цод", "виртуалды data", "виртуалды деректер орталы"), "Виртуальный ЦОД / VDC"),
            (("iaas", "private tender", "vpc"), "IaaS / Private Tender"),
            (("vps", "vds", "виртуальный сервер", "виртуального выделенного сервера", "выделенный сервер"), "Аренда VPS/VDS / выделенного сервера"),
            (("vcpu", "vram", "vhdd", "vssd", "вычислительных мощностей", "физического размещения информации на сервере", "есептеу қуат"), "Аренда вычислительных ресурсов"),
            (("виртуальная машина", "виртуалды машина", "виртуальных машин"), "Виртуальные машины"),
            (("backup", "baas", "резервное копирование", "резервтік көші", "сақтық көшір"), "Резервное копирование / BaaS"),
            (("схд", "хранение данных", "дискілік кеңістік"), "Хранение данных / СХД"),
            (("colocation", "co-location", "гермозон", "стойко-мест"), "Colocation / размещение оборудования"),
            (("vpn", "firewall"), "Защищенная сеть / firewall"),
            (("sap", "erp"), "Инфраструктура для SAP/ERP"),
            (("информационная безопасность", "информационной безопасности", "кибербезопасность", "кибербезопасности"), "Информационная безопасность"),
            (("soc", "оциб", "siem", "dlp", "edr", "xdr", "soar"), "SOC / SIEM / DLP / EDR"),
            (("fortigate", "fortinet", "ngfw", "межсетевой экран"), "NGFW / FortiGate / межсетевой экран"),
            (("ddos", "кибератак", "защита от внешних кибератак"), "Защита от DDoS и кибератак"),
            (("пентест", "тестирование на проникновение", "аудит безопасности"), "Аудит безопасности / пентест"),
            (("скзи", "криптозащита", "антивирус"), "СКЗИ / криптозащита / антивирусная защита"),
        ]
        for markers, label in checks:
            if any(marker in terms for marker in markers):
                services.append(label)
        return services or ["Облачная инфраструктура Tender"]

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
