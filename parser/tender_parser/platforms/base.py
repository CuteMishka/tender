from abc import ABC, abstractmethod

from tender_parser.schemas import TenderLot


class TenderPlatform(ABC):
    name: str

    @abstractmethod
    def search(self, keywords: list[str]) -> list[TenderLot]:
        raise NotImplementedError

    @abstractmethod
    def enrich(self, lot: TenderLot) -> TenderLot:
        raise NotImplementedError

    @abstractmethod
    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        raise NotImplementedError
