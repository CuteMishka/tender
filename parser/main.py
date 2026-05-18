import argparse

from tender_parser.config import Settings
from tender_parser.db import Database
from tender_parser.scheduler import ParserScheduler


def main() -> None:
    parser = argparse.ArgumentParser(description="TenderMachine V2 parser")
    parser.add_argument("--once", action="store_true", help="Run one parser cycle and exit")
    parser.add_argument("--reanalyze-existing", action="store_true", help="Re-run AI suitability check for existing saved lots")
    parser.add_argument("--limit", type=int, default=0, help="Limit lots for --reanalyze-existing. 0 means all lots")
    args = parser.parse_args()

    settings = Settings()
    db = Database(settings.database_url)
    db.create_schema()
    scheduler = ParserScheduler(settings=settings, db=db)
    if args.reanalyze_existing:
        scheduler.reanalyze_existing_lots(max(0, args.limit))
    elif args.once:
        scheduler.run_once()
    else:
        scheduler.run_forever()


if __name__ == "__main__":
    main()
