from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


@dataclass(slots=True)
class TenderDocument:
    name: str
    url: str
    kind: str = "document"
    content_type: str | None = None
    sha256: str | None = None
    local_path: str | None = None


@dataclass(slots=True)
class TenderLot:
    source: str
    external_id: str
    url: str
    title: str
    description: str = ""
    amount: Decimal | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    place: str | None = None
    customer_name: str | None = None
    organizer_name: str | None = None
    purchase_type: str | None = None
    status: str = "active"
    complaints_count: int | None = None
    winner_bin: str | None = None
    winner_name: str | None = None
    raw: dict = field(default_factory=dict)
    documents: list[TenderDocument] = field(default_factory=list)

    @property
    def stable_id(self) -> str:
        return f"{self.source}:{self.external_id}"
