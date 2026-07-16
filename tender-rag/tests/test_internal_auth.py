from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.internal_auth import InternalServiceAuthMiddleware


def make_client(token: str) -> TestClient:
    app = FastAPI()
    app.add_middleware(InternalServiceAuthMiddleware, token=token)

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/v1/lot/analyze")
    def analyze() -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app)


def make_environment_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(InternalServiceAuthMiddleware)

    @app.post("/v1/lot/analyze")
    def analyze() -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app)


def test_health_is_available_without_internal_token() -> None:
    client = make_client("")
    assert client.get("/health").status_code == 200


def test_missing_configuration_fails_closed() -> None:
    client = make_client("")
    response = client.post("/v1/lot/analyze")
    assert response.status_code == 503


def test_missing_or_wrong_token_is_rejected() -> None:
    client = make_client("a" * 48)
    assert client.post("/v1/lot/analyze").status_code == 401
    assert client.post(
        "/v1/lot/analyze",
        headers={"X-Internal-Service-Token": "b" * 48},
    ).status_code == 401


def test_valid_internal_token_is_accepted() -> None:
    token = "a" * 48
    client = make_client(token)
    response = client.post(
        "/v1/lot/analyze",
        headers={"X-Internal-Service-Token": token},
    )
    assert response.status_code == 200


def test_only_rag_specific_environment_token_is_accepted(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    legacy = "l" * 48
    rag_token = "r" * 48
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", legacy)
    monkeypatch.delenv("RAG_INTERNAL_SERVICE_TOKEN", raising=False)
    legacy_client = make_environment_client()
    assert legacy_client.post(
        "/v1/lot/analyze",
        headers={"X-Internal-Service-Token": legacy},
    ).status_code == 503

    monkeypatch.setenv("RAG_INTERNAL_SERVICE_TOKEN", rag_token)
    rag_client = make_environment_client()
    assert rag_client.post(
        "/v1/lot/analyze",
        headers={"X-Internal-Service-Token": rag_token},
    ).status_code == 200
    assert rag_client.post(
        "/v1/lot/analyze",
        headers={"X-Internal-Service-Token": legacy},
    ).status_code == 401


def test_websocket_scope_fails_closed() -> None:
    reached = False
    messages: list[dict[str, object]] = []

    async def downstream(scope, receive, send) -> None:  # type: ignore[no-untyped-def]
        nonlocal reached
        reached = True

    async def receive() -> dict[str, object]:
        return {"type": "websocket.connect"}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    middleware = InternalServiceAuthMiddleware(downstream, token="x" * 32)
    asyncio.run(middleware({"type": "websocket", "path": "/future"}, receive, send))

    assert reached is False
    assert messages == [{"type": "websocket.close", "code": 4401}]
