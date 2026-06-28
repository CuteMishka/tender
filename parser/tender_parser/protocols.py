import re

from tender_parser.schemas import TenderLot


def enrich_winner_from_text(lot: TenderLot, text: str) -> TenderLot:
    bin_match = re.search(r"(?:БИН|ИИН)\s*(?:победителя)?\s*[:№#-]?\s*(\d{12})", text, re.IGNORECASE)
    if bin_match:
        lot.winner_bin = bin_match.group(1)
    name_match = re.search(r"Победител[ья]\s*[:№#-]?\s*([^\n\r]{4,180})", text, re.IGNORECASE)
    if name_match:
        lot.winner_name = name_match.group(1).strip()
    return lot
