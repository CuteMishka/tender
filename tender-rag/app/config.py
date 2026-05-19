import json
import os
import hashlib
import threading
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://rag:rag@localhost:5437/rag")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "384"))

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1").strip()
LOT_ANALYZE_AI_PROVIDER = os.environ.get("LOT_ANALYZE_AI_PROVIDER", os.environ.get("AI_PROVIDER", "gemini")).strip().lower()
LOT_ANALYZE_CHAT_MODEL = os.environ.get(
    "LOT_ANALYZE_CHAT_MODEL",
    os.environ.get("CHAT_MODEL", "gemini-2.5-flash" if LOT_ANALYZE_AI_PROVIDER == "gemini" else "llama-3.1-8b-instant"),
).strip()
SPEC_AI_PROVIDER = os.environ.get("SPEC_AI_PROVIDER", "groq").strip().lower()
SPEC_CHAT_MODEL = os.environ.get("SPEC_CHAT_MODEL", "llama-3.1-8b-instant").strip()
if LOT_ANALYZE_AI_PROVIDER == "gemini" and LOT_ANALYZE_CHAT_MODEL in {"gemini-1.5-flash-8b", "models/gemini-1.5-flash-8b"}:
    LOT_ANALYZE_CHAT_MODEL = "gemini-2.5-flash"
AI_PROVIDER = LOT_ANALYZE_AI_PROVIDER
CHAT_MODEL = LOT_ANALYZE_CHAT_MODEL
GEMINI_CACHE_TTL_SECONDS = int(os.environ.get("GEMINI_CACHE_TTL_SECONDS", "86400"))
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
_gemini_inflight: dict[str, threading.Event] = {}
_gemini_lock = threading.Lock()
_gemini_last_request_at = 0.0


def _gemini_cache_key(system: str, user: str, temperature: float) -> str:
    return _ai_cache_key(AI_PROVIDER, CHAT_MODEL, system, user, temperature)


def _ai_cache_key(provider: str, model: str, system: str, user: str, temperature: float) -> str:
    payload = json.dumps(
        {
            "provider": provider,
            "model": model,
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


def is_ai_configured() -> bool:
    if AI_PROVIDER == "groq":
        return bool(GROQ_API_KEY)
    return bool(GEMINI_API_KEY)


def is_spec_ai_configured() -> bool:
    if SPEC_AI_PROVIDER == "groq":
        return bool(GROQ_API_KEY)
    return bool(GEMINI_API_KEY)


def ai_configuration() -> dict[str, Any]:
    key = GROQ_API_KEY if AI_PROVIDER == "groq" else GEMINI_API_KEY
    key_name = "GROQ_API_KEY" if AI_PROVIDER == "groq" else "GEMINI_API_KEY"
    return {
        "provider": AI_PROVIDER,
        "model": CHAT_MODEL,
        "configured": bool(key),
        "key_defined": key_name in os.environ,
        "key_length": len(key),
        "spec_provider": SPEC_AI_PROVIDER,
        "spec_model": SPEC_CHAT_MODEL,
        "spec_configured": is_spec_ai_configured(),
    }


def _provider_api_key(provider: str) -> str:
    return GROQ_API_KEY if provider == "groq" else GEMINI_API_KEY


def gemini_chat(
    system: str,
    user: str,
    temperature: float = 0.2,
) -> str:
    return ai_chat(system, user, temperature, provider=AI_PROVIDER, model=CHAT_MODEL)


def ai_chat(
    system: str,
    user: str,
    temperature: float = 0.2,
    *,
    provider: str,
    model: str,
) -> str:
    """Отправляет запрос в выбранный AI-провайдер и возвращает текст ответа."""
    rate_limit_exceptions: tuple[type[Exception], ...] = ()
    try:
        from google.api_core.exceptions import ResourceExhausted

        rate_limit_exceptions += (ResourceExhausted,)
    except Exception:
        pass
    try:
        from openai import RateLimitError

        rate_limit_exceptions += (RateLimitError,)
    except Exception:
        pass

    provider = provider.strip().lower()
    model = model.strip()
    key = _ai_cache_key(provider, model, system, user, temperature)
    cached = _read_gemini_cache(key)
    if cached is not None:
        return cached

    owner, event = _wait_or_register_gemini_request(key)
    if not owner:
        event.wait(timeout=180)
        cached = _read_gemini_cache(key)
        if cached is not None:
            return cached
        raise RuntimeError("Gemini: анализ уже выполнялся, но кэш не был получен. Попробуйте позже.")

    api_key = _provider_api_key(provider)
    if not api_key:
        _finish_gemini_request(key, event)
        env_name = "GROQ_API_KEY" if provider == "groq" else "GEMINI_API_KEY"
        raise ValueError(f"{env_name} не задан в .env")

    try:
        delays = [5, 15, 30][:max(0, GEMINI_MAX_RETRIES)]
        last_err: Exception = RuntimeError("неизвестная ошибка")
        for attempt, delay in enumerate([0] + delays):
            if delay:
                time.sleep(delay)
            try:
                _respect_gemini_rate_limit()
                if provider == "groq":
                    from openai import OpenAI

                    client = OpenAI(api_key=api_key, base_url=GROQ_BASE_URL)
                    response = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        temperature=temperature,
                        response_format={"type": "json_object"},
                    )
                    text = response.choices[0].message.content or ""
                else:
                    import google.generativeai as genai

                    genai.configure(api_key=api_key)
                    gemini_model = genai.GenerativeModel(
                        model_name=model,
                        system_instruction=system,
                        generation_config=genai.GenerationConfig(
                            temperature=temperature,
                            response_mime_type="application/json",
                        ),
                    )
                    response = gemini_model.generate_content(user)
                    text = response.text
                if not text:
                    raise RuntimeError(f"Пустой ответ от {provider}")
                _write_gemini_cache(key, text)
                return text
            except rate_limit_exceptions as e:
                last_err = e
                if attempt == len(delays):
                    break
                continue
            except Exception as e:
                raise

        raise RuntimeError(
            f"{provider}: превышен лимит запросов (429). Подождите минуту и попробуйте снова. Детали: {last_err}"
        )
    finally:
        _finish_gemini_request(key, event)


def gemini_chat_json(
    system: str,
    user: str,
    temperature: float = 0.2,
) -> Any:
    return ai_chat_json(system, user, temperature, provider=AI_PROVIDER, model=CHAT_MODEL)


def spec_chat_json(
    system: str,
    user: str,
    temperature: float = 0.2,
) -> Any:
    return ai_chat_json(system, user, temperature, provider=SPEC_AI_PROVIDER, model=SPEC_CHAT_MODEL)


def ai_chat_json(
    system: str,
    user: str,
    temperature: float = 0.2,
    *,
    provider: str,
    model: str,
) -> Any:
    """Возвращает уже распарсенный JSON из ответа AI."""
    text = ai_chat(system, user, temperature, provider=provider, model=model)
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
        raise RuntimeError(f"{provider} вернул невалидный JSON: {e}\n{text[:300]}") from e


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
