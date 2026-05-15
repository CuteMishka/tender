from abc import ABC, abstractmethod
from collections.abc import Callable

from tender_parser.schemas import TenderLot


class TenderPlatform(ABC):
    name: str

    @abstractmethod
    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        raise NotImplementedError

    @abstractmethod
    def enrich(self, lot: TenderLot) -> TenderLot:
        raise NotImplementedError

    @abstractmethod
    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        raise NotImplementedError
