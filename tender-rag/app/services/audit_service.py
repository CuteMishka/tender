from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LotEvent


async def log_lot_event(
    session: AsyncSession,
    lot_id: str,
    event_type: str,
    message: str | None = None,
    payload: dict[str, Any] | None = None,
    actor_user_id: int | None = None,
) -> LotEvent:
    event = LotEvent(
        lot_id=lot_id,
        event_type=event_type,
        message=message,
        payload=payload,
        actor_user_id=actor_user_id,
    )
    session.add(event)
    await session.flush()
    return event
