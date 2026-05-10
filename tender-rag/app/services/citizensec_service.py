from __future__ import annotations

import asyncio
import base64
import os
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CitizenSecIncident
from app.services.audit_service import log_lot_event
from app.services.gemini_service import gemini_json
from app.services.lot_service import get_or_import_lot
from app.services.storage_service import ObjectStorageService

INCIDENT_SYSTEM_PROMPT = """Ты L1 AI-консультант CitizenSec по обработке обращений о мошенничестве и вредоносном контенте.
На входе отчет VirusTotal и контекст обращения. Сформируй человекочитаемое резюме, классификацию угрозы и черновик поста для соцсетей.
Не преувеличивай риск, если отчет не подтверждает вредоносность. Укажи, что нужно проверить аналитику вручную.

Ответ строго JSON без markdown:
{
  "threat_label": "phishing|malware|scam|benign|unknown",
  "severity": "low|medium|high|critical",
  "summary": "2-5 предложений для оператора L1",
  "recommended_actions": ["действие 1"],
  "social_post_draft": "короткий черновик поста без раскрытия персональных данных",
  "kb_payload": {
    "title": "название кейса",
    "tags": ["tag"],
    "indicators": ["ioc"],
    "lessons": ["вывод"]
  }
}"""


class VirusTotalService:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("VIRUSTOTAL_API_KEY", "")
        self.base_url = "https://www.virustotal.com/api/v3"
        self.timeout = float(os.environ.get("VIRUSTOTAL_TIMEOUT", "45"))

    async def analyze_url(self, url: str) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("VIRUSTOTAL_API_KEY is not configured")
        async with httpx.AsyncClient(timeout=self.timeout, headers=self._headers()) as client:
            submit = await client.post(f"{self.base_url}/urls", data={"url": url})
            submit.raise_for_status()
            analysis_id = submit.json()["data"]["id"]
            payload = await self._wait_for_analysis(client, analysis_id)
        payload["analysis_id"] = analysis_id
        return payload

    async def analyze_file(self, filename: str, content: bytes) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("VIRUSTOTAL_API_KEY is not configured")
        async with httpx.AsyncClient(timeout=self.timeout, headers=self._headers()) as client:
            submit = await client.post(
                f"{self.base_url}/files",
                files={"file": (filename, content)},
            )
            submit.raise_for_status()
            analysis_id = submit.json()["data"]["id"]
            payload = await self._wait_for_analysis(client, analysis_id)
        payload["analysis_id"] = analysis_id
        return payload


    async def _wait_for_analysis(self, client: httpx.AsyncClient, analysis_id: str) -> dict[str, Any]:
        attempts = int(os.environ.get("VIRUSTOTAL_POLL_ATTEMPTS", "6"))
        delay = float(os.environ.get("VIRUSTOTAL_POLL_DELAY", "5"))
        payload: dict[str, Any] = {}
        for attempt in range(attempts):
            report = await client.get(f"{self.base_url}/analyses/{analysis_id}")
            report.raise_for_status()
            payload = report.json()
            status = ((payload.get("data") or {}).get("attributes") or {}).get("status")
            if status == "completed" or attempt == attempts - 1:
                return payload
            await asyncio.sleep(delay)
        return payload

    def _headers(self) -> dict[str, str]:
        return {"x-apikey": self.api_key}


async def analyze_incident_url(
    session: AsyncSession,
    url: str,
    lot_id: str | None = None,
    submitted_by_user_id: int | None = None,
    context: str | None = None,
) -> CitizenSecIncident:
    if lot_id:
        await get_or_import_lot(session, lot_id)
    vt_report = await VirusTotalService().analyze_url(url)
    ai = await _summarize_incident("url", url, vt_report, context)
    incident = CitizenSecIncident(
        lot_id=lot_id,
        submitted_by_user_id=submitted_by_user_id,
        input_type="url",
        original_url=url,
        virustotal_analysis_id=str(vt_report.get("analysis_id") or ""),
        virustotal_report=vt_report,
        threat_label=str(ai.get("threat_label") or "unknown"),
        severity=str(ai.get("severity") or "medium"),
        summary=str(ai.get("summary") or ""),
        social_post_draft=str(ai.get("social_post_draft") or ""),
        kb_payload=ai.get("kb_payload") if isinstance(ai.get("kb_payload"), dict) else ai,
    )
    session.add(incident)
    await session.flush()
    if lot_id:
        await log_lot_event(session, lot_id, "citizensec_url_analyzed", "URL analyzed via VirusTotal and Gemini", {"incident_id": incident.id, "url": url, "threat_label": incident.threat_label})
    await session.commit()
    return incident


async def analyze_incident_file(
    session: AsyncSession,
    filename: str,
    content: bytes,
    lot_id: str | None = None,
    submitted_by_user_id: int | None = None,
    context: str | None = None,
) -> CitizenSecIncident:
    if lot_id:
        await get_or_import_lot(session, lot_id)
    vt_report = await VirusTotalService().analyze_file(filename, content)
    storage_key = f"citizensec/incidents/{vt_report.get('analysis_id') or filename}"
    storage = await ObjectStorageService().put_bytes(storage_key, content, "application/octet-stream")
    ai = await _summarize_incident("file", filename, vt_report, context)
    incident = CitizenSecIncident(
        lot_id=lot_id,
        submitted_by_user_id=submitted_by_user_id,
        input_type="file",
        original_filename=filename,
        storage_key=storage.get("key"),
        virustotal_analysis_id=str(vt_report.get("analysis_id") or ""),
        virustotal_report=vt_report,
        threat_label=str(ai.get("threat_label") or "unknown"),
        severity=str(ai.get("severity") or "medium"),
        summary=str(ai.get("summary") or ""),
        social_post_draft=str(ai.get("social_post_draft") or ""),
        kb_payload=ai.get("kb_payload") if isinstance(ai.get("kb_payload"), dict) else ai,
    )
    session.add(incident)
    await session.flush()
    if lot_id:
        await log_lot_event(session, lot_id, "citizensec_file_analyzed", "File analyzed via VirusTotal and Gemini", {"incident_id": incident.id, "filename": filename, "threat_label": incident.threat_label})
    await session.commit()
    return incident


async def _summarize_incident(input_type: str, subject: str, vt_report: dict[str, Any], context: str | None) -> dict[str, Any]:
    compact_report = _compact_virustotal_report(vt_report)
    user_prompt = f"""### Тип входа
{input_type}

### Объект анализа
{subject}

### Контекст обращения
{context or 'нет'}

### VirusTotal compact report
{compact_report}

Сформируй резюме для L1, классификацию и черновик поста."""
    data = await gemini_json(INCIDENT_SYSTEM_PROMPT, user_prompt, temperature=0.2)
    return data if isinstance(data, dict) else {}


def _compact_virustotal_report(report: dict[str, Any]) -> dict[str, Any]:
    data = report.get("data") or {}
    attrs = data.get("attributes") or {}
    stats = attrs.get("stats") or attrs.get("last_analysis_stats") or {}
    results = attrs.get("results") or attrs.get("last_analysis_results") or {}
    detections: list[dict[str, Any]] = []
    for engine, result in list(results.items())[:20]:
        if result.get("category") in {"malicious", "suspicious"}:
            detections.append({"engine": engine, "category": result.get("category"), "result": result.get("result")})
    return {
        "analysis_id": report.get("analysis_id") or data.get("id"),
        "status": attrs.get("status"),
        "stats": stats,
        "detections": detections[:10],
        "permalink_hint": _make_vt_permalink(report),
    }


def _make_vt_permalink(report: dict[str, Any]) -> str | None:
    analysis_id = report.get("analysis_id")
    if not analysis_id:
        return None
    return "https://www.virustotal.com/gui/analysis/" + base64.urlsafe_b64encode(str(analysis_id).encode()).decode().rstrip("=")
