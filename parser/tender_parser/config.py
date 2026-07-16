from pathlib import Path
from typing import Any
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://tender:tender@localhost:5433/tender"
    rag_api_base: str = "http://localhost:8083"
    backend_internal_service_token: str | None = Field(default=None, validation_alias="BACKEND_INTERNAL_SERVICE_TOKEN")
    rag_internal_service_token: str | None = Field(default=None, validation_alias="RAG_INTERNAL_SERVICE_TOKEN")
    poll_interval_seconds: int = Field(default=1800, ge=30)
    max_workers: int = Field(default=4, ge=1, le=32)
    headless: bool = True
    download_dir: Path = Path("downloads")
    strict_keyword_filter: bool = True
    collect_all_active_lots: bool = False
    keywords_file_path: Path | None = Field(default=None, validation_alias="KEYWORDS_FILE_PATH")
    smart_match_enabled: bool = True
    smart_match_use_morphology: bool = True
    semantic_match_enabled: bool = False
    semantic_model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    semantic_match_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    min_keyword_score: float = Field(default=0.55, ge=0.0, le=1.0)
    ai_lot_filter_enabled: bool = True
    ai_lot_filter_min_score: int = Field(default=50, ge=0, le=100)
    ai_company_profile: str | None = (
        "Tender предоставляет облачную и дата-центровую инфраструктуру: OpenNebula, VMware, виртуальный ЦОД/VDC, "
        "IaaS, VPS/VDS, Private Tender, tender services, выделенные и виртуальные серверы, аренду серверов и серверных "
        "мощностей, аренду вычислительных мощностей, vCPU/vRAM/vHDD/vSSD, ЦОД, центр обработки данных, colocation/"
        "co-location, аренду стойко-мест, размещение оборудования, гермозону, СХД, хранение данных, резервное "
        "копирование, Backup/BaaS, DRaaS, аварийное восстановление, защищенные каналы, сетевую инфраструктуру и "
        "техническую поддержку облачных инфраструктур, включая SAP/ERP-нагрузки. Также Tender рассматривает "
        "услуги информационной безопасности и кибербезопасности: SOC/ОЦИБ, SIEM, DLP, EDR/XDR, SOAR, NGFW/FortiGate/"
        "Fortinet, защиту от DDoS и внешних кибератак, аудит безопасности, пентест, тестирование на проникновение, "
        "СКЗИ, криптозащиту, антивирусную защиту и сопровождение средств защиты информации."
    )
    ai_context_keywords_csv: str = Field(
        default="OpenNebula, виртуальный ЦОД, VDC, VPC, виртуальный дата центр, сервер, виртуальный сервер, выделенный сервер, co-location, colocation, аренда стойко-мест, размещение оборудования, Backup, BaaS, резервное копирование, VMware, облачные услуги, tender services, гермозона, DRaaS, IaaS, VPS, VDS, Private Tender, СХД, хранение данных, аренда серверного, аренда сервера, аренда серверных мощностей, вычислительные мощности, аренда вычислительных мощностей, центр обработки данных, ЦОД, дата-центр, vCPU, vRAM, vHDD, vSSD, виртуальная машина, SAP, ERP, аварийное восстановление, защищенный канал, VPN, firewall, информационная безопасность, информационной безопасности, кибербезопасность, SOC, ОЦИБ, SIEM, DLP, EDR, XDR, SOAR, NGFW, FortiGate, Fortinet, защита от DDoS, защита от внешних кибератак, аудит безопасности, пентест, тестирование на проникновение, СКЗИ, криптозащита, антивирус, услуги по обеспечению безопасности",
        validation_alias="AI_CONTEXT_KEYWORDS",
    )
    ai_require_spec_text: bool = Field(default=True, validation_alias="AI_REQUIRE_SPEC_TEXT")
    ai_spec_text_max_chars: int = Field(default=9000, ge=1000, le=50000)
    ai_prompt_max_chars: int = Field(default=12000, ge=4000, le=50000)
    groq_api_key: str | None = None
    groq_api_base: str = "http://localhost:11434/v1"
    groq_model: str = "qwen2.5:3b"
    ai_provider: str = "groq"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    dictionaries_api_url: str | None = None
    stop_words_api_url: str | None = None
    stop_at_first_seen_lot: bool = False
    process_existing_lots: bool = True
    max_lots_per_cycle: int = Field(default=0, ge=0)
    platforms_csv: str = Field(default="tenderplus", validation_alias="PLATFORMS")
    default_keywords_csv: str = Field(
        default="",
        validation_alias="DEFAULT_KEYWORDS",
    )
    default_stop_words_csv: str = Field(default="", validation_alias="DEFAULT_STOP_WORDS")
    our_bins_csv: str = Field(default="", validation_alias="OUR_BINS")

    goszakup_base_url: str = "https://goszakup.gov.kz"
    goszakup_search_url: str = "https://goszakup.gov.kz/ru/search/lots"
    goszakup_lots_count_record: int = Field(default=50, ge=10, le=50)
    goszakup_lots_max_pages: int = Field(default=0, ge=0, le=1000)
    goszakup_ows_base_url: str = "https://ows.goszakup.gov.kz"
    goszakup_ows_graphql_url: str = "https://ows.goszakup.gov.kz/v3/graphql"
    goszakup_ows_token: str | None = None
    zakup_public_base_url: str = "https://zakup.gov.kz"
    zakup_lots_url: str = "https://zakup.gov.kz/home/lots"
    zakup_host_resolver_ip: str | None = None
    zakup_lots_limit: int = Field(default=100, ge=1, le=100)
    zakup_lots_max_pages: int = Field(default=0, ge=0, le=1000)
    zakup_lots_system_ids: str = ""
    zakup_ows_limit_per_page: int = Field(default=200, ge=1, le=200)
    zakup_ows_max_pages_per_keyword: int = Field(default=0, ge=0, le=1000)
    samruk_search_url: str = "https://zakupki.kz/result"
    tenderplus_url: str = "https://api.tenderplus.kz/graphql"
    tenderplus_token: str | None = None
    tenderplus_page_size: int = Field(default=25, ge=1, le=100)
    tenderplus_max_pages: int = Field(default=0, ge=0, le=1000)
    tenderplus_max_lots: int = Field(default=50, ge=1, le=500)
    tenderplus_include_documents: bool = True
    tenderplus_document_max_downloads: int = Field(default=2, ge=0, le=10)
    tenderplus_rag_index_documents: bool = False

    rag_extract_spec_points: bool = True
    rag_include_extracted_text: bool = False
    rag_spec_ai_max_per_cycle: int = Field(default=10, ge=0)
    rag_rate_limit_cooldown_seconds: int = Field(default=900, ge=0)
    ai_request_delay_seconds: float = Field(default=1.5, ge=0)
    ai_rate_limit_cooldown_seconds: int = Field(default=120, ge=0)
    request_timeout_seconds: int = Field(default=60, ge=5)
    retry_attempts: int = Field(default=3, ge=1)
    retry_backoff_seconds: float = Field(default=2.0, ge=0.1)
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

    @field_validator(
        "rag_api_base",
        "goszakup_base_url",
        "goszakup_search_url",
        "goszakup_ows_base_url",
        "goszakup_ows_graphql_url",
        "zakup_public_base_url",
        "zakup_lots_url",
        "samruk_search_url",
        "tenderplus_url",
        "dictionaries_api_url",
        "stop_words_api_url",
        "groq_api_base",
    )
    @classmethod
    def strip_url(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else value

    @field_validator("keywords_file_path", mode="before")
    @classmethod
    def empty_path_to_none(cls, value: Any) -> Any:
        if value is None:
            return None
        if str(value).strip() == "":
            return None
        return value

    @field_validator("backend_internal_service_token", "rag_internal_service_token", mode="before")
    @classmethod
    def validate_internal_service_token(cls, value: Any) -> str | None:
        if value is None or str(value).strip() == "":
            return None
        token = str(value).strip()
        if len(token) < 32:
            raise ValueError("internal service tokens must contain at least 32 characters")
        return token

    @model_validator(mode="after")
    def require_distinct_internal_service_tokens(self) -> "Settings":
        if (
            self.backend_internal_service_token
            and self.backend_internal_service_token == self.rag_internal_service_token
        ):
            raise ValueError("BACKEND_INTERNAL_SERVICE_TOKEN and RAG_INTERNAL_SERVICE_TOKEN must be distinct")
        return self

    @property
    def platforms(self) -> list[str]:
        return self._split_csv(self.platforms_csv)

    @property
    def default_keywords(self) -> list[str]:
        return self._split_csv(self.default_keywords_csv)

    @property
    def default_stop_words(self) -> list[str]:
        return self._split_csv(self.default_stop_words_csv)

    @property
    def ai_context_keywords(self) -> list[str]:
        return self._split_csv(self.ai_context_keywords_csv)

    @property
    def our_bins(self) -> list[str]:
        return self._split_csv(self.our_bins_csv)

    def _split_csv(self, value: str) -> list[str]:
        return [part.strip() for part in value.split(",") if part.strip()]
