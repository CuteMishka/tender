from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.responses import JSONResponse


def build_health_response(
    database_check: Callable[[], tuple[bool, str | None]],
    ai_status: Callable[[], Any],
) -> JSONResponse:
    """Return a failing HTTP status when the database is unavailable."""
    database_ok, database_error = database_check()
    payload: dict[str, Any] = {
        "ok": database_ok,
        "database": database_ok,
        "ai": ai_status(),
    }
    if database_error is not None:
        payload["database_error"] = database_error
    return JSONResponse(status_code=200 if database_ok else 503, content=payload)
