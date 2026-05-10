from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import EMBEDDING_DIM


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(255))


class SavedLot(Base, TimestampMixin):
    __tablename__ = "saved_lots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str | None] = mapped_column(String(64), index=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purchase_type: Mapped[str | None] = mapped_column(String(100))


class Lot(Base, TimestampMixin):
    __tablename__ = "lots"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    external_id: Mapped[str | None] = mapped_column(Text, index=True)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    status: Mapped[str] = mapped_column(String(64), server_default="active", index=True, nullable=False)
    source: Mapped[str | None] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(Text)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    final_ai_reasoning: Mapped[str | None] = mapped_column(Text)
    bitrix_deal_id: Mapped[str | None] = mapped_column(String(64), index=True)
    crm_status: Mapped[str | None] = mapped_column(String(128))
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class LotEvent(Base):
    __tablename__ = "lot_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(Text, ForeignKey("lots.id", ondelete="CASCADE"), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class TenderChunk(Base):
    __tablename__ = "tender_chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
    source_hint: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LotItem(Base, TimestampMixin):
    __tablename__ = "lot_items"
    __table_args__ = (
        UniqueConstraint("lot_id", "paragraph_index", name="lot_items_lot_id_paragraph_index_key"),
        Index("lot_items_embedding_hnsw", "embedding", postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"}),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(Text, ForeignKey("lots.id", ondelete="CASCADE"), index=True, nullable=False)
    item_number: Mapped[str | None] = mapped_column(String(64))
    paragraph_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    source_hint: Mapped[str | None] = mapped_column(Text)


class CompetitorMarker(Base, TimestampMixin):
    __tablename__ = "competitor_markers"
    __table_args__ = (
        Index("competitor_markers_embedding_hnsw", "embedding", postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"}),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_name: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    competitor_name: Mapped[str | None] = mapped_column(Text)
    marker_type: Mapped[str] = mapped_column(String(80), server_default="feature", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
    severity: Mapped[float] = mapped_column(Float, server_default="0.5", nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))


class SpecSuspicion(Base):
    __tablename__ = "spec_suspicions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(Text, ForeignKey("lots.id", ondelete="CASCADE"), index=True, nullable=False)
    lot_item_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lot_items.id", ondelete="SET NULL"))
    marker_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("competitor_markers.id", ondelete="SET NULL"))
    paragraph_index: Mapped[int] = mapped_column(Integer, nullable=False)
    paragraph_text: Mapped[str] = mapped_column(Text, nullable=False)
    product_name: Mapped[str | None] = mapped_column(Text)
    similarity: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(32), server_default="medium", nullable=False)
    verdict: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    development_cost_estimate: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class ClientProfile(Base, TimestampMixin):
    __tablename__ = "client_profiles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bin: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    company_name: Mapped[str | None] = mapped_column(Text)
    domain: Mapped[str | None] = mapped_column(Text)
    employees_count: Mapped[int | None] = mapped_column(Integer)
    contacts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class CommercialProposal(Base):
    __tablename__ = "commercial_proposals"
    __table_args__ = (UniqueConstraint("proposal_number", "version", name="commercial_proposals_number_version_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(Text, ForeignKey("lots.id", ondelete="CASCADE"), index=True, nullable=False)
    client_profile_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("client_profiles.id", ondelete="SET NULL"))
    proposal_number: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    service_package: Mapped[str] = mapped_column(String(80), nullable=False)
    discount_percent: Mapped[float] = mapped_column(Float, server_default="0", nullable=False)
    currency: Mapped[str] = mapped_column(String(8), server_default="KZT", nullable=False)
    price_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    vat_included: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(32), nullable=False)
    storage_bucket: Mapped[str | None] = mapped_column(Text)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    file_url: Mapped[str | None] = mapped_column(Text)
    template_name: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), server_default="draft", nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class LotDecisionKnowledgeChunk(Base):
    __tablename__ = "lot_decision_knowledge_chunks"
    __table_args__ = (
        Index("lot_decision_knowledge_chunks_embedding_hnsw", "embedding", postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"}),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(Text, ForeignKey("lots.id", ondelete="CASCADE"), index=True, nullable=False)
    decision: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    updated_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CitizenSecIncident(Base):
    __tablename__ = "citizensec_incidents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str | None] = mapped_column(Text, ForeignKey("lots.id", ondelete="SET NULL"), index=True)
    submitted_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    input_type: Mapped[str] = mapped_column(String(16), nullable=False)
    original_url: Mapped[str | None] = mapped_column(Text)
    original_filename: Mapped[str | None] = mapped_column(Text)
    storage_key: Mapped[str | None] = mapped_column(Text)
    virustotal_analysis_id: Mapped[str | None] = mapped_column(Text)
    virustotal_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    threat_label: Mapped[str | None] = mapped_column(String(80), index=True)
    severity: Mapped[str | None] = mapped_column(String(32))
    summary: Mapped[str | None] = mapped_column(Text)
    social_post_draft: Mapped[str | None] = mapped_column(Text)
    kb_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class CitizenSecKnowledgeChunk(Base):
    __tablename__ = "citizensec_knowledge_chunks"
    __table_args__ = (
        Index("citizensec_knowledge_chunks_embedding_hnsw", "embedding", postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"}),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)
