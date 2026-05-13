from tender_parser.db import Database
from tender_parser.schemas import TenderLot


class NotificationService:
    def __init__(self, db: Database, our_bins: list[str]) -> None:
        self.db = db
        self.our_bins = {value.strip() for value in our_bins if value.strip()}

    def lot_created(self, lot: TenderLot) -> None:
        self.db.notify(
            lot.stable_id,
            "success",
            "updates",
            "Новый релевантный лот",
            f"{lot.title} найден на площадке {lot.source}.",
            {"url": lot.url, "source": lot.source, "external_id": lot.external_id},
        )

    def lot_changed(self, lot: TenderLot, changes: list[str]) -> None:
        labels = {
            "lot_fields": "изменены данные лота",
            "documents": "обновлены документы/ТС",
            "complaints": "изменились жалобы",
            "winner": "появился победитель",
        }
        message = ", ".join(labels.get(change, change) for change in changes)
        self.db.notify(
            lot.stable_id,
            "warning",
            "updates",
            "Изменение по лоту",
            f"{lot.title}: {message}.",
            {"url": lot.url, "changes": changes, "source": lot.source, "external_id": lot.external_id},
        )

    def rag_indexed(self, lot: TenderLot, document_name: str, text_chars: int | None) -> None:
        self.db.notify(
            lot.stable_id,
            "info",
            "review",
            "ТС отправлена в RAG",
            f"{document_name}: индексировано {text_chars or 0} символов.",
            {"url": lot.url, "source": lot.source, "external_id": lot.external_id},
        )

    def winner_detected(self, lot: TenderLot) -> None:
        if not lot.winner_bin:
            return
        won = lot.winner_bin in self.our_bins
        self.db.notify(
            lot.stable_id,
            "success" if won else "info",
            "updates",
            "Мы выиграли тендер" if won else "Определён победитель тендера",
            f"{lot.title}: победитель {lot.winner_name or 'не указан'}, БИН {lot.winner_bin}.",
            {"url": lot.url, "winner_bin": lot.winner_bin, "winner_name": lot.winner_name, "won": won},
        )
