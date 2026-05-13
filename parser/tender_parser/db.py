from collections.abc import Iterable
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from tender_parser.fingerprints import stable_json_hash
from tender_parser.schemas import TenderDocument, TenderLot


class Base(DeclarativeBase):
    pass


class ParserKeyword(Base):
    __tablename__ = "parser_keywords"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    value: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class ParserLot(Base):
    __tablename__ = "parser_lots"
    __table_args__ = (UniqueConstraint("source", "external_id", name="parser_lots_source_external_id_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stable_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    place: Mapped[str | None] = mapped_column(Text)
    customer_name: Mapped[str | None] = mapped_column(Text)
    organizer_name: Mapped[str | None] = mapped_column(Text)
    purchase_type: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(64), default="active", nullable=False, index=True)
    complaints_count: Mapped[int | None] = mapped_column(Integer)
    winner_bin: Mapped[str | None] = mapped_column(String(32), index=True)
    winner_name: Mapped[str | None] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    documents_fingerprint: Mapped[str | None] = mapped_column(String(64))
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class ParserDocument(Base):
    __tablename__ = "parser_documents"
    __table_args__ = (UniqueConstraint("lot_stable_id", "url", name="parser_documents_lot_url_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_stable_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(64), default="document", nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255))
    sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    local_path: Mapped[str | None] = mapped_column(Text)
    text_chars: Mapped[int | None] = mapped_column(Integer)
    rag_indexed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class ParserNotification(Base):
    __tablename__ = "parser_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_stable_id: Mapped[str | None] = mapped_column(String(255), index=True)
    type: Mapped[str] = mapped_column(String(32), default="info", nullable=False)
    category: Mapped[str] = mapped_column(String(64), default="updates", nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class ParserRun(Base):
    __tablename__ = "parser_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), default="running", nullable=False)
    platforms: Mapped[list[str] | None] = mapped_column(JSONB)
    keywords: Mapped[list[str] | None] = mapped_column(JSONB)
    lots_found: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lots_changed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    errors: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)


class Database:
    def __init__(self, url: str) -> None:
        self.engine = create_engine(url, pool_pre_ping=True)
        self.SessionLocal = sessionmaker(self.engine, expire_on_commit=False)

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def session(self) -> Session:
        return self.SessionLocal()

    def seed_keywords(self, keywords: Iterable[str]) -> None:
        with self.session() as session:
            for value in keywords:
                normalized = value.strip()
                if not normalized:
                    continue
                stmt = insert(ParserKeyword).values(value=normalized, active=True).on_conflict_do_nothing(index_elements=["value"])
                session.execute(stmt)
            session.commit()

    def load_keywords(self, fallback: list[str]) -> list[str]:
        with self.session() as session:
            rows = list(session.scalars(select(ParserKeyword.value).where(ParserKeyword.active.is_(True)).order_by(ParserKeyword.value.asc())))
        if rows:
            return rows
        self.seed_keywords(fallback)
        return fallback

    def start_run(self, platforms: list[str], keywords: list[str]) -> int:
        with self.session() as session:
            run = ParserRun(platforms=platforms, keywords=keywords)
            session.add(run)
            session.commit()
            return run.id

    def finish_run(self, run_id: int, status: str, lots_found: int, lots_changed: int, errors: list[dict[str, Any]]) -> None:
        with self.session() as session:
            run = session.get(ParserRun, run_id)
            if run is None:
                return
            run.status = status
            run.finished_at = datetime.now(timezone.utc)
            run.lots_found = lots_found
            run.lots_changed = lots_changed
            run.errors = errors
            session.commit()

    def upsert_lot(self, lot: TenderLot) -> tuple[bool, list[str]]:
        now = datetime.now(timezone.utc)
        fingerprint = self._lot_fingerprint(lot)
        docs_fingerprint = stable_json_hash({"documents": [asdict(doc) for doc in lot.documents]})
        values = self._lot_values(lot, fingerprint, docs_fingerprint, now)
        with self.session() as session:
            existing = session.scalar(select(ParserLot).where(ParserLot.stable_id == lot.stable_id))
            changes: list[str] = []
            is_new = existing is None
            if existing is not None:
                if existing.fingerprint != fingerprint:
                    changes.append("lot_fields")
                if existing.documents_fingerprint != docs_fingerprint:
                    changes.append("documents")
                if existing.complaints_count != lot.complaints_count:
                    changes.append("complaints")
                if existing.winner_bin != lot.winner_bin and lot.winner_bin:
                    changes.append("winner")
            stmt = insert(ParserLot).values(**values).on_conflict_do_update(
                constraint="parser_lots_source_external_id_key",
                set_={
                    "url": values["url"],
                    "title": values["title"],
                    "description": values["description"],
                    "amount": values["amount"],
                    "start_date": values["start_date"],
                    "end_date": values["end_date"],
                    "place": values["place"],
                    "customer_name": values["customer_name"],
                    "organizer_name": values["organizer_name"],
                    "purchase_type": values["purchase_type"],
                    "status": values["status"],
                    "complaints_count": values["complaints_count"],
                    "winner_bin": values["winner_bin"],
                    "winner_name": values["winner_name"],
                    "fingerprint": values["fingerprint"],
                    "documents_fingerprint": values["documents_fingerprint"],
                    "raw": values["raw"],
                    "last_seen_at": now,
                    "updated_at": now,
                },
            )
            session.execute(stmt)
            session.commit()
            return is_new, changes

    def upsert_document(self, lot: TenderLot, doc: TenderDocument, text_chars: int | None = None, rag_indexed: bool = False) -> None:
        now = datetime.now(timezone.utc)
        values = {
            "lot_stable_id": lot.stable_id,
            "name": doc.name,
            "url": doc.url,
            "kind": doc.kind,
            "content_type": doc.content_type,
            "sha256": doc.sha256,
            "local_path": doc.local_path,
            "text_chars": text_chars,
            "rag_indexed": rag_indexed,
            "updated_at": now,
        }
        with self.session() as session:
            stmt = insert(ParserDocument).values(**values).on_conflict_do_update(
                constraint="parser_documents_lot_url_key",
                set_={**values, "updated_at": now},
            )
            session.execute(stmt)
            session.commit()

    def notify(self, lot_stable_id: str | None, type_: str, category: str, title: str, message: str, payload: dict[str, Any] | None = None) -> None:
        with self.session() as session:
            session.add(ParserNotification(lot_stable_id=lot_stable_id, type=type_, category=category, title=title, message=message, payload=payload))
            session.commit()

    def _lot_fingerprint(self, lot: TenderLot) -> str:
        return stable_json_hash({
            "title": lot.title,
            "description": lot.description,
            "amount": str(lot.amount) if lot.amount is not None else None,
            "start_date": lot.start_date,
            "end_date": lot.end_date,
            "place": lot.place,
            "customer_name": lot.customer_name,
            "organizer_name": lot.organizer_name,
            "purchase_type": lot.purchase_type,
            "status": lot.status,
            "winner_bin": lot.winner_bin,
            "winner_name": lot.winner_name,
        })

    def _lot_values(self, lot: TenderLot, fingerprint: str, docs_fingerprint: str, now: datetime) -> dict[str, Any]:
        return {
            "stable_id": lot.stable_id,
            "source": lot.source,
            "external_id": lot.external_id,
            "url": lot.url,
            "title": lot.title or lot.external_id,
            "description": lot.description or "",
            "amount": lot.amount,
            "start_date": lot.start_date,
            "end_date": lot.end_date,
            "place": lot.place,
            "customer_name": lot.customer_name,
            "organizer_name": lot.organizer_name,
            "purchase_type": lot.purchase_type,
            "status": lot.status,
            "complaints_count": lot.complaints_count,
            "winner_bin": lot.winner_bin,
            "winner_name": lot.winner_name,
            "fingerprint": fingerprint,
            "documents_fingerprint": docs_fingerprint,
            "raw": lot.raw,
            "last_seen_at": now,
            "updated_at": now,
        }
