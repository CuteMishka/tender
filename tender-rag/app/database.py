from __future__ import annotations

import os
import ssl
from collections.abc import AsyncIterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import DATABASE_URL


def _async_database_url(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def _normalize_asyncpg_url(url: str) -> tuple[str, dict[str, object]]:
    async_url = _async_database_url(url)
    parts = urlsplit(async_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    sslmode = None
    filtered_query: list[tuple[str, str]] = []
    for key, value in query:
        if key == "sslmode":
            sslmode = value
        else:
            filtered_query.append((key, value))

    normalized_url = urlunsplit((
        parts.scheme,
        parts.netloc,
        parts.path,
        urlencode(filtered_query),
        parts.fragment,
    ))

    connect_args: dict[str, object] = {}
    if sslmode and sslmode not in {"disable", "allow"}:
        connect_args["ssl"] = ssl.create_default_context()
    return normalized_url, connect_args


ASYNC_DATABASE_URL, ASYNC_CONNECT_ARGS = _normalize_asyncpg_url(DATABASE_URL)


async_engine = create_async_engine(
    ASYNC_DATABASE_URL,
    echo=os.environ.get("SQLALCHEMY_ECHO", "").lower() in {"1", "true", "yes"},
    pool_pre_ping=True,
    connect_args=ASYNC_CONNECT_ARGS,
)

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


async def create_async_schema() -> None:
    from app.models import Base

    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
