import json
import os
import hashlib
import threading
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://rag:rag@localhost:5437/rag")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "384"))

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
CHAT_MODEL = os.environ.get("CHAT_MODEL", "gemini-2.0-flash-lite")
GEMINI_CACHE_TTL_SECONDS = int(os.environ.get("GEMINI_CACHE_TTL_SECONDS", "86400"))
GEMINI_ATTEMPT_TTL_SECONDS = int(os.environ.get("GEMINI_ATTEMPT_TTL_SECONDS", "86400"))
GEMINI_MIN_INTERVAL_SECONDS = float(os.environ.get("GEMINI_MIN_INTERVAL_SECONDS", "12"))
GEMINI_MAX_RETRIES = int(os.environ.get("GEMINI_MAX_RETRIES", "0"))

# Обратная совместимость
OPENAI_CHAT_MODEL = CHAT_MODEL

_cors_raw = os.environ.get("CORS_ORIGINS", "*").strip()
CORS_ORIGINS: list[str] = (
    ["*"]
    if not _cors_raw or _cors_raw == "*"
    else [x.strip() for x in _cors_raw.split(",") if x.strip()]
)

_gemini_cache: dict[str, tuple[float, str]] = {}
_gemini_attempts: dict[str, float] = {}
_gemini_inflight: dict[str, threading.Event] = {}
_gemini_lock = threading.Lock()
_gemini_last_request_at = 0.0


def _gemini_cache_key(system: str, user: str, temperature: float) -> str:
    payload = json.dumps(
        {
            "model": CHAT_MODEL,
            "system": system,
            "user": user,
            "temperature": temperature,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _read_gemini_cache(key: str) -> str | None:
    if GEMINI_CACHE_TTL_SECONDS <= 0:
        return None
    now = time.time()
    with _gemini_lock:
        cached = _gemini_cache.get(key)
        if not cached:
            return None
        ts, value = cached
        if now - ts > GEMINI_CACHE_TTL_SECONDS:
            _gemini_cache.pop(key, None)
            return None
        return value


def _write_gemini_cache(key: str, value: str) -> None:
    if GEMINI_CACHE_TTL_SECONDS <= 0:
        return
    with _gemini_lock:
        _gemini_cache[key] = (time.time(), value)


def _read_gemini_attempt(key: str) -> bool:
    if GEMINI_ATTEMPT_TTL_SECONDS <= 0:
        return False
    now = time.time()
    with _gemini_lock:
        ts = _gemini_attempts.get(key)
        if ts is None:
            return False
        if now - ts > GEMINI_ATTEMPT_TTL_SECONDS:
            _gemini_attempts.pop(key, None)
            return False
        return True


def _write_gemini_attempt(key: str) -> None:
    if GEMINI_ATTEMPT_TTL_SECONDS <= 0:
        return
    with _gemini_lock:
        _gemini_attempts[key] = time.time()


def _wait_or_register_gemini_request(key: str) -> tuple[bool, threading.Event]:
    with _gemini_lock:
        existing = _gemini_inflight.get(key)
        if existing:
            return False, existing
        event = threading.Event()
        _gemini_inflight[key] = event
        return True, event


def _finish_gemini_request(key: str, event: threading.Event) -> None:
    with _gemini_lock:
        _gemini_inflight.pop(key, None)
        event.set()


def _respect_gemini_rate_limit() -> None:
    global _gemini_last_request_at
    if GEMINI_MIN_INTERVAL_SECONDS <= 0:
        return
    with _gemini_lock:
        now = time.time()
        wait = GEMINI_MIN_INTERVAL_SECONDS - (now - _gemini_last_request_at)
        if wait > 0:
            time.sleep(wait)
        _gemini_last_request_at = time.time()


def gemini_chat(
    system: str,
    user: str,
    temperature: float = 0.2,
) -> str:
    """Отправляет запрос в Gemini и возвращает текст ответа. Retry при 429."""
    import google.generativeai as genai
    from google.api_core.exceptions import ResourceExhausted

    key = _gemini_cache_key(system, user, temperature)
    cached = _read_gemini_cache(key)
    if cached is not None:
        return cached
    if _read_gemini_attempt(key):
        raise RuntimeError("Gemini: этот анализ уже запрашивался. Повторный запрос заблокирован, чтобы не расходовать квоту.")

    owner, event = _wait_or_register_gemini_request(key)
    if not owner:
        event.wait(timeout=180)
        cached = _read_gemini_cache(key)
        if cached is not None:
            return cached
        raise RuntimeError("Gemini: анализ уже выполнялся, но кэш не был получен. Попробуйте позже.")

    api_key = GEMINI_API_KEY
    if not api_key:
        _finish_gemini_request(key, event)
        raise ValueError("GEMINI_API_KEY не задан в .env")

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=CHAT_MODEL,
            system_instruction=system,
            generation_config=genai.GenerationConfig(
                temperature=temperature,
                response_mime_type="application/json",
            ),
        )

        delays = [5, 15, 30][:max(0, GEMINI_MAX_RETRIES)]
        last_err: Exception = RuntimeError("неизвестная ошибка")
        for attempt, delay in enumerate([0] + delays):
            if delay:
                time.sleep(delay)
            try:
                _respect_gemini_rate_limit()
                _write_gemini_attempt(key)
                response = model.generate_content(user)
                text = response.text
                if not text:
                    raise RuntimeError("Пустой ответ от Gemini")
                _write_gemini_cache(key, text)
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
    finally:
        _finish_gemini_request(key, event)


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
