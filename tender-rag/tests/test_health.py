from __future__ import annotations

import json

from app.health import build_health_response


def response_payload(response) -> dict[str, object]:  # type: ignore[no-untyped-def]
    return json.loads(response.body.decode("utf-8"))


def test_health_is_200_only_when_database_is_available() -> None:
    response = build_health_response(
        lambda: (True, None),
        lambda: {"provider": "local"},
    )

    assert response.status_code == 200
    assert response_payload(response) == {
        "ok": True,
        "database": True,
        "ai": {"provider": "local"},
    }


def test_health_is_503_when_database_is_unavailable() -> None:
    response = build_health_response(
        lambda: (False, "connection refused"),
        lambda: {"provider": "local"},
    )

    assert response.status_code == 503
    assert response_payload(response) == {
        "ok": False,
        "database": False,
        "ai": {"provider": "local"},
        "database_error": "connection refused",
    }
