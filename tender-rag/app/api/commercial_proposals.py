from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.commercial_proposal_service import generate_commercial_proposal

router = APIRouter(prefix="/v1", tags=["commercial-proposals"])


class CommercialProposalCreateIn(BaseModel):
    service_package: str
    discount_percent: float = Field(0, ge=0, le=100)
    client: dict[str, Any] | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int | None = None


class CommercialProposalOut(BaseModel):
    id: int
    lot_id: str
    client_profile_id: int | None
    proposal_number: str
    version: int
    service_package: str
    discount_percent: float
    currency: str
    price_payload: dict[str, Any]
    total_amount: float
    storage_backend: str
    storage_bucket: str | None
    storage_key: str
    file_url: str | None
    status: str


@router.post("/lots/{lot_id}/commercial-proposals", response_model=CommercialProposalOut)
async def create_commercial_proposal(
    lot_id: str,
    body: CommercialProposalCreateIn,
    session: AsyncSession = Depends(get_session),
) -> CommercialProposalOut:
    try:
        proposal = await generate_commercial_proposal(
            session,
            lot_id=lot_id,
            service_package=body.service_package,
            discount_percent=body.discount_percent,
            client_payload=body.client,
            parameters=body.parameters,
            created_by_user_id=body.created_by_user_id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return CommercialProposalOut.model_validate(proposal, from_attributes=True)
