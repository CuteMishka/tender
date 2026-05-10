from __future__ import annotations

import asyncio
from typing import Any

from app.config import gemini_chat_json


async def gemini_json(system: str, user: str, temperature: float = 0.2) -> Any:
    return await asyncio.to_thread(gemini_chat_json, system, user, temperature)
