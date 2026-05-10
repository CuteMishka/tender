from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.bitrix_service import BitrixService

router = APIRouter(prefix="/v1", tags=["crm"])


class ExportLotBody(BaseModel):
    actor_user_id: int | None = None


class ExportLotResponse(BaseModel):
    lot_id: str
    deal_id: str
    bitrix_response: dict[str, Any]


class BitrixWebhookResponse(BaseModel):
    lot_id: str
    deal_id: str
    stage_id: str | None = None
    status: str | None = None
    status_changed: bool


@router.post("/lots/{lot_id}/crm/export", response_model=ExportLotResponse)
async def export_lot_to_crm(
    lot_id: str,
    body: ExportLotBody,
    session: AsyncSession = Depends(get_session),
) -> ExportLotResponse:
    try:
        result = await BitrixService().export_lot_to_crm(session, lot_id, body.actor_user_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ExportLotResponse(**result)


@router.post("/crm/bitrix/webhook", response_model=BitrixWebhookResponse)
async def bitrix_status_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> BitrixWebhookResponse:
    expected_secret = os.environ.get("BITRIX24_WEBHOOK_SECRET", "").strip()
    if expected_secret and request.query_params.get("secret") != expected_secret:
        raise HTTPException(status_code=403, detail="invalid webhook secret")

    payload = await _read_payload(request)
    deal_id = _extract_first(payload, "deal_id", "ID", "id", "data[FIELDS][ID]", "FIELDS[ID]")
    stage_id = _extract_first(payload, "stage_id", "STAGE_ID", "data[FIELDS][STAGE_ID]", "FIELDS[STAGE_ID]")
    if not deal_id:
        raise HTTPException(status_code=400, detail="deal id not found in webhook payload")

    try:
        result = await BitrixService().sync_deal_status(session, str(deal_id), str(stage_id) if stage_id else None)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return BitrixWebhookResponse(**result)


async def _read_payload(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        data = await request.json()
        return data if isinstance(data, dict) else {"payload": data}
    form = await request.form()
    return {key: value for key, value in form.multi_items()}


def _extract_first(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    data = payload.get("data")
    if isinstance(data, dict):
        fields = data.get("FIELDS") or data.get("fields")
        if isinstance(fields, dict):
            for key in keys:
                normalized = key.split("[")[-1].rstrip("]")
                if normalized in fields and fields[normalized] not in (None, ""):
                    return fields[normalized]
    fields = payload.get("FIELDS") or payload.get("fields")
    if isinstance(fields, dict):
        for key in keys:
            normalized = key.split("[")[-1].rstrip("]")
            if normalized in fields and fields[normalized] not in (None, ""):
                return fields[normalized]
    return None
