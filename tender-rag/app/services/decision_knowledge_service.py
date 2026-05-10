from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings import embed_chunks, embed_profile
from app.models import LotDecisionKnowledgeChunk
from app.services.audit_service import log_lot_event
from app.services.lot_service import get_or_import_lot, set_lot_status


async def replace_lot_decision_reason(
    session: AsyncSession,
    lot_id: str,
    decision: str,
    reason: str,
    payload: dict[str, Any] | None = None,
    updated_by_user_id: int | None = None,
) -> LotDecisionKnowledgeChunk:
    lot = await get_or_import_lot(session, lot_id)
    embedding_text = f"Решение по тендеру: {decision}. Причина: {reason}"
    embedding = (await asyncio.to_thread(embed_chunks, [embedding_text]))[0]
    await session.execute(delete(LotDecisionKnowledgeChunk).where(LotDecisionKnowledgeChunk.lot_id == lot.id))
    chunk = LotDecisionKnowledgeChunk(
        lot_id=lot.id,
        decision=decision,
        reason=reason,
        embedding=embedding,
        payload=payload,
        updated_by_user_id=updated_by_user_id,
    )
    session.add(chunk)
    await set_lot_status(session, lot, decision)
    await log_lot_event(
        session,
        lot.id,
        "decision_reason_reindexed",
        "Decision reason reindexed for future RAG analysis",
        {"decision": decision, "reason": reason, "knowledge_chunk_id": chunk.id},
        updated_by_user_id,
    )
    await session.commit()
    return chunk


async def search_decision_reasons(
    session: AsyncSession,
    query: str,
    limit: int = 10,
) -> list[dict[str, Any]]:
    query_embedding = await asyncio.to_thread(embed_profile, query)
    distance = LotDecisionKnowledgeChunk.embedding.cosine_distance(query_embedding)
    result = await session.execute(
        select(LotDecisionKnowledgeChunk, (1 - distance).label("score"))
        .order_by(distance.asc())
        .limit(limit)
    )
    return [
        {
            "id": row[0].id,
            "lot_id": row[0].lot_id,
            "decision": row[0].decision,
            "reason": row[0].reason,
            "score": float(row[1]),
            "payload": row[0].payload,
        }
        for row in result.all()
    ]
