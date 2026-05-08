import json
import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://rag:rag@localhost:5437/rag")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "384"))

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
CHAT_MODEL = os.environ.get("CHAT_MODEL", "gemini-1.5-flash")

# Обратная совместимость
OPENAI_CHAT_MODEL = CHAT_MODEL

_cors_raw = os.environ.get("CORS_ORIGINS", "*").strip()
CORS_ORIGINS: list[str] = (
    ["*"]
    if not _cors_raw or _cors_raw == "*"
    else [x.strip() for x in _cors_raw.split(",") if x.strip()]
)


def gemini_chat(
    system: str,
    user: str,
    temperature: float = 0.2,
) -> str:
    """Отправляет запрос в Gemini и возвращает текст ответа. Retry при 429."""
    import time
    import google.generativeai as genai
    from google.api_core.exceptions import ResourceExhausted

    api_key = GEMINI_API_KEY
    if not api_key:
        raise ValueError("GEMINI_API_KEY не задан в .env")

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=CHAT_MODEL,
        system_instruction=system,
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            response_mime_type="application/json",
        ),
    )

    delays = [5, 15, 30]
    last_err: Exception = RuntimeError("неизвестная ошибка")
    for attempt, delay in enumerate([0] + delays):
        if delay:
            time.sleep(delay)
        try:
            response = model.generate_content(user)
            text = response.text
            if not text:
                raise RuntimeError("Пустой ответ от Gemini")
            return text
        except ResourceExhausted as e:
            last_err = e
            if attempt == len(delays):
                break
            continue
        except Exception as e:
            raise

    raise RuntimeError(
        f"Gemini: превышен лимит запросов (429). Подождите минуту и попробуйте снова. Детали: {last_err}"
    )


def gemini_chat_json(
    system: str,
    user: str,
    temperature: float = 0.2,
) -> Any:
    """Возвращает уже распарсенный JSON из ответа Gemini."""
    text = gemini_chat(system, user, temperature)
    # Убираем markdown-обёртку если модель всё же добавила ```json
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[-1] if cleaned.count("```") >= 2 else cleaned
        cleaned = cleaned.lstrip("json").strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini вернул невалидный JSON: {e}\n{text[:300]}") from e


def get_company_profile() -> str:
    """Текст профиля компании из COMPANY_PROFILE_FILE или COMPANY_PROFILE."""
    path = os.environ.get("COMPANY_PROFILE_FILE", "").strip()
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                t = f.read().strip()
                if t:
                    return t
        except OSError:
            pass
    return os.environ.get("COMPANY_PROFILE", "").strip()
