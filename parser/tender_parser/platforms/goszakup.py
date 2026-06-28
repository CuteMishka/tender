from collections.abc import Callable

from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform
from tender_parser.schemas import TenderLot


class GoszakupPlatform(TenderPlatform):
    name = "goszakup"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, keywords: list[str], is_seen: Callable[[str], bool] | None = None) -> list[TenderLot]:
        raise RuntimeError("The goszakup browser parser is disabled. Use PLATFORMS=tenderplus.")

    def enrich(self, lot: TenderLot) -> TenderLot:
        return lot

    def load_final_protocol(self, lot: TenderLot) -> TenderLot:
        return lot
