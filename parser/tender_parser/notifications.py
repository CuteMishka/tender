from decimal import Decimal

import httpx
import structlog

from tender_parser.db import Database
from tender_parser.schemas import TenderLot


class NotificationService:
    def __init__(self, db: Database, our_bins: list[str], telegram_bot_token: str | None = None, telegram_chat_id: str | None = None, timeout_seconds: int = 30) -> None:
        self.db = db
        self.our_bins = {value.strip() for value in our_bins if value.strip()}
        self.telegram_bot_token = telegram_bot_token.strip() if telegram_bot_token else ""
        self.telegram_chat_id = telegram_chat_id.strip() if telegram_chat_id else ""
        self.timeout_seconds = timeout_seconds
        self.log = structlog.get_logger("tender_parser.notifications")

    def lot_created(self, lot: TenderLot) -> None:
        title = f"Новый релевантный лот · {lot.source}"
        message = f"{lot.title} найден на площадке {lot.source} по ключу {lot.raw.get('matched_keyword') or lot.raw.get('keyword') or 'не указан'}."
        self.db.notify(
            lot.stable_id,
            "success",
            "updates",
            title,
            message,
            {"url": lot.url, "source": lot.source, "external_id": lot.external_id, "matched_keyword": lot.raw.get("matched_keyword")},
        )
        self._send_telegram(self._format_new_lot_message(lot))

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
            f"Изменение по лоту · {lot.source}",
            f"{lot.title}: {message}. Площадка: {lot.source}.",
            {"url": lot.url, "changes": changes, "source": lot.source, "external_id": lot.external_id, "matched_keyword": lot.raw.get("matched_keyword")},
        )
        self._send_telegram(self._format_lot_changed_message(lot, message))

    def rag_indexed(self, lot: TenderLot, document_name: str, text_chars: int | None) -> None:
        self.db.notify(
            lot.stable_id,
            "info",
            "review",
            "ТС отправлена в RAG",
            f"{document_name}: индексировано {text_chars or 0} символов. Площадка: {lot.source}.",
            {"url": lot.url, "source": lot.source, "external_id": lot.external_id},
        )
        self._send_telegram(self._format_rag_indexed_message(lot, document_name, text_chars))

    def winner_detected(self, lot: TenderLot) -> None:
        if not lot.winner_bin:
            return
        won = lot.winner_bin in self.our_bins
        self.db.notify(
            lot.stable_id,
            "success" if won else "info",
            "updates",
            "Мы выиграли тендер" if won else "Определён победитель тендера",
            f"{lot.title}: победитель {lot.winner_name or 'не указан'}, БИН {lot.winner_bin}. Площадка: {lot.source}.",
            {"url": lot.url, "source": lot.source, "winner_bin": lot.winner_bin, "winner_name": lot.winner_name, "won": won},
        )
        self._send_telegram(self._format_winner_message(lot, won))

    def _send_telegram(self, text: str) -> None:
        bot_token, chat_id = self.db.load_telegram_settings()
        if not bot_token or not chat_id:
            bot_token = self.telegram_bot_token
            chat_id = self.telegram_chat_id
        if not bot_token or not chat_id:
            return
        try:
            response = httpx.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": text[:4096],
                    "disable_web_page_preview": True,
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
        except Exception as exc:
            self.log.warning("telegram_notification_failed", error=str(exc))

    def _format_new_lot_message(self, lot: TenderLot) -> str:
        lines = [
            "Новый подходящий тендер",
            f"Площадка: {lot.source}",
            f"Лот: {lot.external_id}",
            f"Название: {lot.title}",
            f"Ключ: {lot.raw.get('matched_keyword') or lot.raw.get('keyword') or 'не указан'}",
            f"Статус: {lot.status or 'не указан'}",
        ]
        if lot.amount is not None:
            lines.append(f"Сумма: {self._format_amount(lot.amount)}")
        if lot.end_date:
            lines.append(f"Дедлайн: {lot.end_date:%d.%m.%Y %H:%M}")
        if lot.customer_name:
            lines.append(f"Заказчик: {lot.customer_name}")
        if lot.place:
            lines.append(f"Место: {lot.place}")
        if lot.url:
            lines.append(f"Ссылка: {lot.url}")
        return "\n".join(lines)

    def _format_amount(self, amount: Decimal) -> str:
        return f"{amount:,.2f} ₸".replace(",", " ").replace(".00", "")

    def _format_lot_changed_message(self, lot: TenderLot, message: str) -> str:
        lines = [
            "Изменение по тендеру",
            f"Площадка: {lot.source}",
            f"Лот: {lot.external_id}",
            f"Название: {lot.title}",
            f"Изменения: {message}",
        ]
        if lot.url:
            lines.append(f"Ссылка: {lot.url}")
        return "\n".join(lines)

    def _format_rag_indexed_message(self, lot: TenderLot, document_name: str, text_chars: int | None) -> str:
        lines = [
            "Документ индексирован в RAG",
            f"Площадка: {lot.source}",
            f"Лот: {lot.external_id}",
            f"Документ: {document_name}",
            f"Символов: {text_chars or 0}",
        ]
        if lot.url:
            lines.append(f"Ссылка: {lot.url}")
        return "\n".join(lines)

    def _format_winner_message(self, lot: TenderLot, won: bool) -> str:
        lines = [
            "Мы выиграли тендер" if won else "Определён победитель тендера",
            f"Площадка: {lot.source}",
            f"Лот: {lot.external_id}",
            f"Название: {lot.title}",
            f"Победитель: {lot.winner_name or 'не указан'}",
            f"БИН: {lot.winner_bin or 'не указан'}",
        ]
        if lot.url:
            lines.append(f"Ссылка: {lot.url}")
        return "\n".join(lines)
