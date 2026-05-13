from pathlib import Path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://tender:tender@localhost:5433/tender"
    rag_api_base: str = "http://localhost:8083"
    poll_interval_seconds: int = Field(default=300, ge=30)
    max_workers: int = Field(default=4, ge=1, le=32)
    headless: bool = True
    download_dir: Path = Path("downloads")
    platforms_csv: str = Field(default="goszakup,samruk", validation_alias="PLATFORMS")
    default_keywords_csv: str = Field(
        default="кибербезопасность,ОЦИБ,EDR,пентест,аудит безопасности,сервер,облако,виртуализация,backup",
        validation_alias="DEFAULT_KEYWORDS",
    )
    our_bins_csv: str = Field(default="", validation_alias="OUR_BINS")

    goszakup_base_url: str = "https://goszakup.gov.kz"
    goszakup_search_url: str = "https://goszakup.gov.kz/ru/search/lots"
    samruk_search_url: str = "https://zakupki.kz/result"

    rag_extract_spec_points: bool = True
    rag_include_extracted_text: bool = False
    request_timeout_seconds: int = Field(default=60, ge=5)
    retry_attempts: int = Field(default=3, ge=1)
    retry_backoff_seconds: float = Field(default=2.0, ge=0.1)

    @field_validator("rag_api_base", "goszakup_base_url", "goszakup_search_url", "samruk_search_url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def platforms(self) -> list[str]:
        return self._split_csv(self.platforms_csv)

    @property
    def default_keywords(self) -> list[str]:
        return self._split_csv(self.default_keywords_csv)

    @property
    def our_bins(self) -> list[str]:
        return self._split_csv(self.our_bins_csv)

    def _split_csv(self, value: str) -> list[str]:
        return [part.strip() for part in value.split(",") if part.strip()]
