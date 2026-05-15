from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform
from tender_parser.platforms.goszakup import GoszakupPlatform
from tender_parser.platforms.samruk import SamrukPlatform
from tender_parser.platforms.zakup import ZakupPlatform
from tender_parser.platforms.zakup_ows import ZakupOwsPlatform


def build_platforms(settings: Settings) -> list[TenderPlatform]:
    registry = {
        "zakup": ZakupPlatform(settings),
        "zakup_browser": ZakupPlatform(settings),
        "zakup_ows": ZakupOwsPlatform(settings),
        "goszakup": GoszakupPlatform(settings),
        "samruk": SamrukPlatform(settings),
    }
    return [registry[name] for name in settings.platforms if name in registry]
