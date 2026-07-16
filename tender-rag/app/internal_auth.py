from __future__ import annotations

import hashlib
import os
import secrets
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.responses import JSONResponse

INTERNAL_TOKEN_HEADER = b"x-internal-service-token"
MINIMUM_INTERNAL_TOKEN_LENGTH = 32


class InternalServiceAuthMiddleware:
    """Fail-closed authentication for every non-health RAG endpoint."""

    def __init__(self, app: Callable[..., Awaitable[Any]], token: str | None = None) -> None:
        self.app = app
        configured = token if token is not None else os.getenv("RAG_INTERNAL_SERVICE_TOKEN", "")
        configured = configured.strip()
        self.configured = len(configured) >= MINIMUM_INTERNAL_TOKEN_LENGTH
        self.expected_hash = hashlib.sha256(configured.encode("utf-8")).digest()

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        scope_type = scope.get("type")
        if scope_type == "lifespan" or (scope_type == "http" and scope.get("path") == "/health"):
            await self.app(scope, receive, send)
            return

        # There are no WebSocket routes today. Fail closed so a future route
        # cannot silently bypass the internal bearer policy.
        if scope_type == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        if scope_type != "http":
            return

        if not self.configured:
            response = JSONResponse(
                {"detail": "internal authentication is not configured"},
                status_code=503,
            )
            await response(scope, receive, send)
            return

        supplied = b""
        for name, value in scope.get("headers", []):
            if name.lower() == INTERNAL_TOKEN_HEADER:
                supplied = value.strip()
                break
        supplied_hash = hashlib.sha256(supplied).digest()
        if not secrets.compare_digest(supplied_hash, self.expected_hash):
            response = JSONResponse({"detail": "authentication required"}, status_code=401)
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
