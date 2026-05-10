from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import SpecSuspicion
from app.services.tailoring_detection_service import add_competitor_marker, analyze_tailoring, replace_lot_items_from_text

router = APIRouter(prefix="/v1", tags=["tailoring"])


class CompetitorMarkerIn(BaseModel):
    product_name: str
    content: str
    competitor_name: str | None = None
    marker_type: str = "feature"
    severity: float = Field(0.5, ge=0, le=1)
    source_url: str | None = None
    created_by_user_id: int | None = None


class CompetitorMarkerOut(BaseModel):
    id: int
    product_name: str
    competitor_name: str | None
    marker_type: str
    content: str
    severity: float


class LotItemsIndexIn(BaseModel):
    text: str
    source_hint: str | None = None


class LotItemsIndexOut(BaseModel):
    lot_id: str
    items_count: int


class TailoringAnalyzeIn(BaseModel):
    min_similarity: float = Field(0.78, ge=0, le=1)
    top_k: int = Field(3, ge=1, le=10)


class SpecSuspicionOut(BaseModel):
    id: int
    lot_id: str
    paragraph_index: int
    paragraph_text: str
    product_name: str | None
    similarity: float
    confidence: float | None
    risk_level: str
    verdict: str
    explanation: str
    development_cost_estimate: dict[str, Any] | None


@router.post("/competitor-markers", response_model=CompetitorMarkerOut)
async def create_competitor_marker(
    body: CompetitorMarkerIn,
    session: AsyncSession = Depends(get_session),
) -> CompetitorMarkerOut:
    marker = await add_competitor_marker(
        session,
        product_name=body.product_name,
        content=body.content,
        competitor_name=body.competitor_name,
        marker_type=body.marker_type,
        severity=body.severity,
        source_url=body.source_url,
        created_by_user_id=body.created_by_user_id,
    )
    await session.commit()
    return CompetitorMarkerOut.model_validate(marker, from_attributes=True)


@router.post("/lots/{lot_id}/items/index", response_model=LotItemsIndexOut)
async def index_lot_items(
    lot_id: str,
    body: LotItemsIndexIn,
    session: AsyncSession = Depends(get_session),
) -> LotItemsIndexOut:
    try:
        items = await replace_lot_items_from_text(session, lot_id, body.text, body.source_hint)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return LotItemsIndexOut(lot_id=lot_id, items_count=len(items))


@router.post("/lots/{lot_id}/tailoring/analyze", response_model=list[SpecSuspicionOut])
async def analyze_lot_tailoring(
    lot_id: str,
    body: TailoringAnalyzeIn,
    session: AsyncSession = Depends(get_session),
) -> list[SpecSuspicionOut]:
    try:
        findings = await analyze_tailoring(session, lot_id, body.min_similarity, body.top_k)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return [SpecSuspicionOut.model_validate(item, from_attributes=True) for item in findings]


@router.get("/lots/{lot_id}/tailoring", response_model=list[SpecSuspicionOut])
async def list_lot_tailoring(
    lot_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[SpecSuspicionOut]:
    result = await session.execute(
        select(SpecSuspicion).where(SpecSuspicion.lot_id == lot_id).order_by(SpecSuspicion.paragraph_index.asc(), SpecSuspicion.similarity.desc())
    )
    return [SpecSuspicionOut.model_validate(item, from_attributes=True) for item in result.scalars().all()]
