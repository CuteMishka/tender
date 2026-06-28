from tender_parser.config import Settings
from tender_parser.platforms.base import TenderPlatform


def build_platforms(settings: Settings) -> list[TenderPlatform]:
    platforms: list[TenderPlatform] = []
    for name in settings.platforms:
        if name == "tenderplus":
            from tender_parser.platforms.tenderplus import TenderPlusPlatform

            platforms.append(TenderPlusPlatform(settings))
            continue
        raise ValueError(
            f"Platform {name!r} is disabled in the API-only parser build. "
            "Use PLATFORMS=tenderplus."
        )
    return platforms
