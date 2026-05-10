from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.decision_knowledge_service import replace_lot_decision_reason, search_decision_reasons

router = APIRouter(prefix="/v1", tags=["knowledge"])


class DecisionReasonIn(BaseModel):
    decision: str = Field(..., description="participating | rejected | postponed | lost | won")
    reason: str
    payload: dict[str, Any] | None = None
    updated_by_user_id: int | None = None


class DecisionReasonOut(BaseModel):
    id: int
    lot_id: str
    decision: str
    reason: str
    payload: dict[str, Any] | None


class DecisionSearchIn(BaseModel):
    query: str
    limit: int = Field(10, ge=1, le=50)


class DecisionSearchOut(BaseModel):
    id: int
    lot_id: str
    decision: str
    reason: str
    score: float
    payload: dict[str, Any] | None


@router.put("/lots/{lot_id}/decision-reason", response_model=DecisionReasonOut)
async def upsert_lot_decision_reason(
    lot_id: str,
    body: DecisionReasonIn,
    session: AsyncSession = Depends(get_session),
) -> DecisionReasonOut:
    try:
        chunk = await replace_lot_decision_reason(
            session,
            lot_id=lot_id,
            decision=body.decision,
            reason=body.reason,
            payload=body.payload,
            updated_by_user_id=body.updated_by_user_id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return DecisionReasonOut.model_validate(chunk, from_attributes=True)


@router.post("/knowledge/decision-reasons/search", response_model=list[DecisionSearchOut])
async def search_lot_decision_reasons(
    body: DecisionSearchIn,
    session: AsyncSession = Depends(get_session),
) -> list[DecisionSearchOut]:
    rows = await search_decision_reasons(session, body.query, body.limit)
    return [DecisionSearchOut(**row) for row in rows]
