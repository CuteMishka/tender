from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lot, SavedLot


async def get_or_import_lot(session: AsyncSession, lot_id: str) -> Lot:
    lot = await session.get(Lot, str(lot_id))
    if lot is not None:
        return lot

    saved = await session.get(SavedLot, int(lot_id)) if str(lot_id).isdigit() else None
    if saved is not None:
        lot = Lot(
            id=str(saved.id),
            external_id=str(saved.id),
            title=saved.title,
            description=saved.description,
            amount=Decimal(str(saved.amount)) if saved.amount is not None else None,
            status=saved.status or "active",
            deadline=saved.deadline,
            raw_payload={"source_table": "saved_lots"},
        )
        session.add(lot)
        await session.flush()
        return lot

    raise LookupError(f"lot {lot_id} not found")


async def get_lot_by_bitrix_deal_id(session: AsyncSession, deal_id: str) -> Lot | None:
    result = await session.execute(select(Lot).where(Lot.bitrix_deal_id == str(deal_id)))
    return result.scalar_one_or_none()


async def set_lot_status(session: AsyncSession, lot: Lot, status: str, crm_status: str | None = None) -> Lot:
    lot.status = status
    if crm_status is not None:
        lot.crm_status = crm_status
    await session.flush()
    return lot
