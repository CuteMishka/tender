from pathlib import Path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://tender:tender@localhost:5433/tender"
    rag_api_base: str = "http://localhost:8083"
    poll_interval_seconds: int = Field(default=1800, ge=30)
    max_workers: int = Field(default=4, ge=1, le=32)
    headless: bool = True
    download_dir: Path = Path("downloads")
    strict_keyword_filter: bool = False
    collect_all_active_lots: bool = True
    smart_match_enabled: bool = True
    smart_match_use_morphology: bool = True
    semantic_match_enabled: bool = False
    semantic_model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    semantic_match_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    min_keyword_score: float = Field(default=0.55, ge=0.0, le=1.0)
    ai_lot_filter_enabled: bool = False
    ai_lot_filter_min_score: int = Field(default=60, ge=0, le=100)
    ai_company_profile: str | None = (
        "Freedom Cloud — компания в сфере хостинга, облачной инфраструктуры, виртуальных серверов, VPS/VDS, "
        "выделенных серверов, дата-центров, IaaS, хранения данных, резервного копирования, сетевой инфраструктуры, "
        "администрирования серверов, Kubernetes, контейнеризации, информационной безопасности и сопутствующих IT-услуг."
    )
    ai_context_keywords_csv: str = Field(
        default="хостинг, облачный сервер, облачная инфраструктура, виртуальный сервер, VPS, VDS, выделенный сервер, дата-центр, ЦОД, IaaS, PaaS, SaaS, серверное оборудование, аренда сервера, размещение сервера, colocation, резервное копирование, хранение данных, Kubernetes, контейнеризация, виртуализация, Linux, администрирование серверов, информационная безопасность, сетевое оборудование, маршрутизатор, firewall, web hosting, cloud hosting",
        validation_alias="AI_CONTEXT_KEYWORDS",
    )
    groq_api_key: str | None = None
    groq_api_base: str = "https://api.groq.com/openai/v1"
    groq_model: str = "llama-3.1-8b-instant"
    dictionaries_api_url: str | None = None
    stop_at_first_seen_lot: bool = False
    process_existing_lots: bool = True
    max_lots_per_cycle: int = Field(default=0, ge=0)
    platforms_csv: str = Field(default="goszakup", validation_alias="PLATFORMS")
    default_keywords_csv: str = Field(
        default="",
        validation_alias="DEFAULT_KEYWORDS",
    )
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

    rag_extract_spec_points: bool = True
    rag_include_extracted_text: bool = False
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
        "dictionaries_api_url",
        "groq_api_base",
    )
    @classmethod
    def strip_url(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else value

    @property
    def platforms(self) -> list[str]:
        return self._split_csv(self.platforms_csv)

    @property
    def default_keywords(self) -> list[str]:
        return self._split_csv(self.default_keywords_csv)

    @property
    def ai_context_keywords(self) -> list[str]:
        return self._split_csv(self.ai_context_keywords_csv)

    @property
    def our_bins(self) -> list[str]:
        return self._split_csv(self.our_bins_csv)

    def _split_csv(self, value: str) -> list[str]:
        return [part.strip() for part in value.split(",") if part.strip()]
