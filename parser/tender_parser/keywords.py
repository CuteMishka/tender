from tender_parser.db import Database


class KeywordService:
    def __init__(self, db: Database, fallback: list[str]) -> None:
        self.db = db
        self.fallback = fallback

    def load_active(self) -> list[str]:
        return self.db.load_keywords(self.fallback)
