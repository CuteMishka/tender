from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LotEvent
from app.services.audit_service import log_lot_event
from app.services.lot_service import get_lot_by_bitrix_deal_id, get_or_import_lot, set_lot_status


class BitrixService:
    def __init__(self, webhook_url: str | None = None) -> None:
        self.webhook_url = (webhook_url or os.environ.get("BITRIX24_WEBHOOK_URL", "")).rstrip("/")
        self.currency = os.environ.get("BITRIX24_CURRENCY", "KZT")
        self.timeout = float(os.environ.get("BITRIX24_TIMEOUT", "20"))

    async def export_lot_to_crm(self, session: AsyncSession, lot_id: str, actor_user_id: int | None = None) -> dict[str, Any]:
        if not self.webhook_url:
            raise RuntimeError("BITRIX24_WEBHOOK_URL is not configured")

        lot = await get_or_import_lot(session, lot_id)
        if str(lot.status).lower() not in {"participating", "\u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u043c", "uchastvuem"}:
            raise RuntimeError("CRM export allowed only for lots with status participating/uchastvuem")
        events = await self._load_export_events(session, lot.id)
        comments_text = self._format_events(events)
        deal_payload = {
            "fields": {
                "TITLE": f"Тендер #{lot.id}: {lot.title or 'без названия'}",
                "OPPORTUNITY": float(lot.amount or Decimal("0")),
                "CURRENCY_ID": self.currency,
                "COMMENTS": self._build_deal_comments(lot, comments_text),
            },
            "params": {"REGISTER_SONET_EVENT": "Y"},
        }
        response = await self._call("crm.deal.add", deal_payload)
        deal_id = str(response.get("result") or "").strip()
        if not deal_id:
            raise RuntimeError(f"Bitrix did not return deal id: {response}")

        lot.bitrix_deal_id = deal_id
        lot.crm_status = "exported"
        await log_lot_event(
            session,
            lot.id,
            "bitrix_exported",
            f"Лот экспортирован в Bitrix24 как сделка {deal_id}",
            {"deal_id": deal_id, "bitrix_response": response},
            actor_user_id,
        )
        if comments_text:
            await self.add_timeline_comment(deal_id, comments_text)
            await log_lot_event(
                session,
                lot.id,
                "bitrix_comments_exported",
                "Комментарии и финальное обоснование отправлены в ленту CRM",
                {"deal_id": deal_id},
                actor_user_id,
            )
        await session.commit()
        return {"lot_id": lot.id, "deal_id": deal_id, "bitrix_response": response}

    async def sync_deal_status(self, session: AsyncSession, deal_id: str, stage_id: str | None = None) -> dict[str, Any]:
        if not self.webhook_url:
            raise RuntimeError("BITRIX24_WEBHOOK_URL is not configured")

        lot = await get_lot_by_bitrix_deal_id(session, deal_id)
        if lot is None:
            raise LookupError(f"lot with Bitrix deal {deal_id} not found")

        crm_stage = stage_id or await self._get_deal_stage(deal_id)
        new_status = self._map_stage_to_lot_status(crm_stage)
        if new_status is None:
            await log_lot_event(
                session,
                lot.id,
                "bitrix_status_seen",
                "Получен статус сделки Bitrix24 без закрытия лота",
                {"deal_id": deal_id, "stage_id": crm_stage},
            )
            await session.commit()
            return {"lot_id": lot.id, "deal_id": deal_id, "stage_id": crm_stage, "status_changed": False}

        await set_lot_status(session, lot, new_status, crm_stage)
        await log_lot_event(
            session,
            lot.id,
            "bitrix_status_synced",
            f"Статус лота обновлен из Bitrix24: {new_status}",
            {"deal_id": deal_id, "stage_id": crm_stage},
        )
        await session.commit()
        return {"lot_id": lot.id, "deal_id": deal_id, "stage_id": crm_stage, "status": new_status, "status_changed": True}

    async def add_timeline_comment(self, deal_id: str, comment: str) -> dict[str, Any]:
        return await self._call(
            "crm.timeline.comment.add",
            {
                "fields": {
                    "ENTITY_ID": deal_id,
                    "ENTITY_TYPE": "deal",
                    "COMMENT": comment,
                }
            },
        )

    async def _get_deal_stage(self, deal_id: str) -> str | None:
        response = await self._call("crm.deal.get", {"id": deal_id})
        result = response.get("result") or {}
        stage = result.get("STAGE_ID")
        return str(stage) if stage else None

    async def _load_export_events(self, session: AsyncSession, lot_id: str) -> list[LotEvent]:
        result = await session.execute(
            select(LotEvent)
            .where(
                LotEvent.lot_id == lot_id,
                LotEvent.event_type.in_(("comment", "user_comment", "ai_final_reasoning", "final_ai_reasoning", "analysis_final")),
            )
            .order_by(LotEvent.created_at.asc())
        )
        return list(result.scalars().all())

    def _build_deal_comments(self, lot: Any, comments_text: str) -> str:
        rows = [
            f"ID лота: {lot.id}",
            f"Сумма: {lot.amount or 0} {self.currency}",
            f"Ссылка: {lot.source_url or 'не указана'}",
            f"Дедлайн: {self._format_deadline(lot.deadline)}",
        ]
        if lot.final_ai_reasoning:
            rows.append(f"Финальное обоснование AI: {lot.final_ai_reasoning}")
        if comments_text:
            rows.append("Комментарии и аудит:")
            rows.append(comments_text)
        return "\n".join(rows)

    def _format_events(self, events: list[LotEvent]) -> str:
        rows: list[str] = []
        for event in events:
            text = event.message or ""
            if event.payload:
                text = text or str(event.payload.get("text") or event.payload.get("comment") or "")
            if text.strip():
                rows.append(f"[{event.created_at:%Y-%m-%d %H:%M}] {event.event_type}: {text.strip()}")
        return "\n".join(rows)

    def _format_deadline(self, deadline: datetime | None) -> str:
        if deadline is None:
            return "не указан"
        return deadline.isoformat()

    def _map_stage_to_lot_status(self, stage_id: str | None) -> str | None:
        if not stage_id:
            return None
        stage = stage_id.upper()
        if "WON" in stage:
            return "won"
        if "LOSE" in stage or "LOST" in stage or "FAIL" in stage:
            return "lost"
        return None

    async def _call(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.webhook_url}/{method}.json"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
        if "error" in data:
            raise RuntimeError(f"Bitrix24 {method}: {data.get('error_description') or data.get('error')}")
        return data
