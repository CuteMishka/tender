from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.goszakup import GoszakupPlatform
from tender_parser.platforms.samruk import SamrukPlatform


def build_platforms(settings: Settings) -> list[TenderPlatform]:
    registry = {
        "goszakup": GoszakupPlatform(settings),
        "samruk": SamrukPlatform(settings),
    }
    return [registry[name] for name in settings.platforms if name in registry]
