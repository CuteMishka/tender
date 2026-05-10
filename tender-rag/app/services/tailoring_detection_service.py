from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings import embed_chunks
from app.models import CompetitorMarker, LotItem, SpecSuspicion
from app.services.audit_service import log_lot_event
from app.services.gemini_service import gemini_json
from app.services.lot_service import get_or_import_lot

TAILORING_SYSTEM_PROMPT = """Ты эксперт по анализу технических спецификаций закупок в сфере ИБ.
Твоя задача — проверить, похож ли пункт ТС на уникальный функционал конкретного конкурентного продукта.
Не делай юридических выводов и не утверждай нарушение. Оцени только техническую подозрительность.
Если пункт описывает типовое рыночное требование, снизь риск даже при семантическом сходстве.
Если в пункте есть новый функционал, которого нет в профиле нашей компании, оцени грубую стоимость разработки.

Ответ строго JSON без markdown:
{
  "is_suspicious": true,
  "confidence": 0.0,
  "risk_level": "low|medium|high",
  "verdict": "короткая строка вида: пункт на 90% совпадает с функционалом продукта X",
  "explanation": "почему пункт считается или не считается подозрительным",
  "development_cost_estimate": {
    "needed": false,
    "reason": "",
    "rough_hours": 0,
    "rough_cost_kzt": 0
  }
}"""


@dataclass(frozen=True)
class MarkerCandidate:
    marker: CompetitorMarker
    similarity: float


async def add_competitor_marker(
    session: AsyncSession,
    product_name: str,
    content: str,
    competitor_name: str | None = None,
    marker_type: str = "feature",
    severity: float = 0.5,
    source_url: str | None = None,
    created_by_user_id: int | None = None,
) -> CompetitorMarker:
    embedding = (await asyncio.to_thread(embed_chunks, [content]))[0]
    marker = CompetitorMarker(
        product_name=product_name,
        competitor_name=competitor_name,
        marker_type=marker_type,
        content=content,
        embedding=embedding,
        severity=severity,
        source_url=source_url,
        created_by_user_id=created_by_user_id,
    )
    session.add(marker)
    await session.flush()
    return marker


async def replace_lot_items_from_text(
    session: AsyncSession,
    lot_id: str,
    text: str,
    source_hint: str | None = None,
) -> list[LotItem]:
    await get_or_import_lot(session, lot_id)
    paragraphs = split_spec_paragraphs(text)
    embeddings = await asyncio.to_thread(embed_chunks, [p[1] for p in paragraphs]) if paragraphs else []
    await session.execute(delete(LotItem).where(LotItem.lot_id == lot_id))
    items: list[LotItem] = []
    for idx, ((item_number, content), embedding) in enumerate(zip(paragraphs, embeddings, strict=True)):
        item = LotItem(
            lot_id=lot_id,
            item_number=item_number,
            paragraph_index=idx,
            content=content,
            embedding=embedding,
            source_hint=source_hint,
        )
        session.add(item)
        items.append(item)
    await log_lot_event(
        session,
        lot_id,
        "lot_items_indexed",
        f"Индексировано пунктов ТС: {len(items)}",
        {"source_hint": source_hint, "items_count": len(items)},
    )
    await session.commit()
    return items


async def analyze_tailoring(
    session: AsyncSession,
    lot_id: str,
    min_similarity: float = 0.78,
    top_k: int = 3,
) -> list[SpecSuspicion]:
    await get_or_import_lot(session, lot_id)
    result = await session.execute(select(LotItem).where(LotItem.lot_id == lot_id).order_by(LotItem.paragraph_index.asc()))
    items = list(result.scalars().all())
    if not items:
        raise ValueError("lot_items is empty: index specification paragraphs first")

    await session.execute(delete(SpecSuspicion).where(SpecSuspicion.lot_id == lot_id))
    findings: list[SpecSuspicion] = []
    for item in items:
        if item.embedding is None:
            item.embedding = (await asyncio.to_thread(embed_chunks, [item.content]))[0]
            await session.flush()
        candidates = await _find_marker_candidates(session, item.embedding, top_k)
        for candidate in candidates:
            if candidate.similarity < min_similarity:
                continue
            verdict = await _classify_with_gemini(item, candidate)
            if not verdict.get("is_suspicious", False):
                continue
            finding = SpecSuspicion(
                lot_id=lot_id,
                lot_item_id=item.id,
                marker_id=candidate.marker.id,
                paragraph_index=item.paragraph_index,
                paragraph_text=item.content,
                product_name=candidate.marker.product_name,
                similarity=candidate.similarity,
                confidence=_float_or_none(verdict.get("confidence")),
                risk_level=str(verdict.get("risk_level") or "medium"),
                verdict=str(verdict.get("verdict") or "Подозрительное сходство с конкурентным маркером"),
                explanation=str(verdict.get("explanation") or "Gemini не вернул пояснение"),
                development_cost_estimate=verdict.get("development_cost_estimate") if isinstance(verdict.get("development_cost_estimate"), dict) else None,
            )
            session.add(finding)
            findings.append(finding)

    await log_lot_event(
        session,
        lot_id,
        "tailoring_detected",
        f"Проверка заточек завершена, найдено подозрительных пунктов: {len(findings)}",
        {"findings_count": len(findings), "min_similarity": min_similarity, "top_k": top_k},
    )
    await session.commit()
    return findings


async def _find_marker_candidates(session: AsyncSession, embedding: list[float], top_k: int) -> list[MarkerCandidate]:
    distance = CompetitorMarker.embedding.cosine_distance(embedding)
    result = await session.execute(
        select(CompetitorMarker, (1 - distance).label("similarity"))
        .order_by(distance.asc())
        .limit(top_k)
    )
    return [MarkerCandidate(marker=row[0], similarity=float(row[1])) for row in result.all()]


async def _classify_with_gemini(item: LotItem, candidate: MarkerCandidate) -> dict[str, Any]:
    user_prompt = f"""### Пункт ТС
Номер пункта: {item.item_number or item.paragraph_index}
Текст пункта:
{item.content}

### Маркер конкурентного решения
Продукт: {candidate.marker.product_name}
Конкурент: {candidate.marker.competitor_name or 'не указан'}
Тип маркера: {candidate.marker.marker_type}
Описание уникального функционала:
{candidate.marker.content}

### Семантическое сходство pgvector
{candidate.similarity:.4f}

Сформируй вердикт для подсветки интерфейса. Если пункт похож на уникальную функцию продукта, явно укажи процент сходства и продукт. Если это типовое требование рынка, верни is_suspicious=false."""
    data = await gemini_json(TAILORING_SYSTEM_PROMPT, user_prompt, temperature=0.1)
    return data if isinstance(data, dict) else {}


def split_spec_paragraphs(text: str) -> list[tuple[str | None, str]]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    raw_parts = re.split(r"\n{2,}|(?=\n?\s*\d+(?:\.\d+)+[).]?\s+)", normalized)
    out: list[tuple[str | None, str]] = []
    for raw in raw_parts:
        content = " ".join(raw.split()).strip()
        if len(content) < 20:
            continue
        match = re.match(r"^(\d+(?:\.\d+)+)[).]?\s+(.*)$", content)
        if match:
            out.append((match.group(1), match.group(2).strip()))
        else:
            out.append((None, content))
    return out


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
