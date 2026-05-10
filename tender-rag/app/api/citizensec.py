from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.citizensec_service import analyze_incident_file, analyze_incident_url

router = APIRouter(prefix="/v1/citizensec", tags=["citizensec"])


class IncidentUrlIn(BaseModel):
    url: str
    lot_id: str | None = None
    submitted_by_user_id: int | None = None
    context: str | None = None


class IncidentOut(BaseModel):
    id: int
    input_type: str
    original_url: str | None
    original_filename: str | None
    virustotal_analysis_id: str | None
    threat_label: str | None
    severity: str | None
    summary: str | None
    social_post_draft: str | None
    kb_payload: dict[str, Any] | None


@router.post("/incidents/url", response_model=IncidentOut)
async def create_url_incident(
    body: IncidentUrlIn,
    session: AsyncSession = Depends(get_session),
) -> IncidentOut:
    try:
        incident = await analyze_incident_url(
            session,
            url=body.url,
            lot_id=body.lot_id,
            submitted_by_user_id=body.submitted_by_user_id,
            context=body.context,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return IncidentOut.model_validate(incident, from_attributes=True)


@router.post("/incidents/file", response_model=IncidentOut)
async def create_file_incident(
    file: Annotated[UploadFile, File()],
    lot_id: Annotated[str | None, Form()] = None,
    submitted_by_user_id: Annotated[int | None, Form()] = None,
    context: Annotated[str | None, Form()] = None,
    session: AsyncSession = Depends(get_session),
) -> IncidentOut:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        incident = await analyze_incident_file(
            session,
            filename=file.filename or "incident.bin",
            content=content,
            lot_id=lot_id,
            submitted_by_user_id=submitted_by_user_id,
            context=context,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return IncidentOut.model_validate(incident, from_attributes=True)
