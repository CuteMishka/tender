"""Сжатая выжимка техспецификации тендера через AI (JSON)."""

from __future__ import annotations

from typing import Any

from app.config import SPEC_AI_PROVIDER, spec_chat_json

MAX_SPEC_CHARS = 48_000

SYSTEM_SPEC = """Ты аналитик по госзакупкам и техзаданиям (Казахстан, русский язык).
Дан полный или фрагментированный текст документации лота / ТЗ / спецификации.

Задача: выделить проверяемые факты из текста. Не выдумывай требования — только то, что явно следует из текста. Если чего-то нет в тексте, честно отрази это в open_questions.

Ответ строго JSON (без markdown):
{
  "overview": "2–4 предложения: предмет закупки и контекст",
  "services": [
    {
      "name": "короткое название услуги из ТС",
      "category": "категория: ИТ, облако, сопровождение, лицензии, сеть, безопасность, прочее",
      "quantity": "объем/количество/срок, если явно указан",
      "requirements": ["ключевое требование к этой услуге"],
      "evidence": "короткая цитата или фрагмент из ТС"
    }
  ],
  "key_requirements": ["важное требование 1", "..."],
  "deliverables": ["что нужно поставить/сделать — пунктами"],
  "terms_and_deadlines": ["сроки, этапы, расписание — если есть в тексте"],
  "constraints": ["ограничения: лицензии, стандарты, объём, территория и т.д."],
  "open_questions": ["что уточнить у заказчика или проверить в полном комплекте документов"]
}

Массив services должен содержать отдельные услуги/работы из ТС, а не общие разделы документа. Не объединяй разные услуги в одну, если в тексте они перечислены отдельно.
Массивы могут быть пустыми [], строки — короткие и конкретные."""


def _truncate(s: str, limit: int) -> str:
    s = s.strip()
    if len(s) <= limit:
        return s
    return s[: limit - 30] + "\n… [текст обрезан для модели]"


def summarize_specification(spec_text: str) -> dict[str, Any]:
    """Структурированная выжимка ТЗ через AI."""
    text = _truncate(spec_text, MAX_SPEC_CHARS)
    if not text:
        raise ValueError("Пустой текст спецификации")

    user = "### Текст документа (ТЗ / спецификация / описание лота)\n\n" + text
    data = spec_chat_json(SYSTEM_SPEC, user, temperature=0.15)
    return _normalize_payload(data)


def _normalize_payload(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise RuntimeError("Модель вернула не объект JSON")

    def str_list(key: str) -> list[str]:
        v = data.get(key)
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        if isinstance(v, str) and v.strip():
            return [v.strip()]
        return []

    def service_list(key: str) -> list[dict[str, Any]]:
        v = data.get(key)
        if not isinstance(v, list):
            return []
        result: list[dict[str, Any]] = []
        for item in v:
            if isinstance(item, str):
                name = item.strip()
                if name:
                    result.append({"name": name, "category": "", "quantity": "", "requirements": [], "evidence": ""})
                continue
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("title") or item.get("service") or "").strip()
            if not name:
                continue
            requirements_raw = item.get("requirements")
            if isinstance(requirements_raw, list):
                requirements = [str(x).strip() for x in requirements_raw if str(x).strip()]
            elif isinstance(requirements_raw, str) and requirements_raw.strip():
                requirements = [requirements_raw.strip()]
            else:
                requirements = []
            result.append({
                "name": name,
                "category": str(item.get("category") or "").strip(),
                "quantity": str(item.get("quantity") or "").strip(),
                "requirements": requirements[:6],
                "evidence": str(item.get("evidence") or "").strip(),
            })
        return result[:80]

    return {
        "provider": SPEC_AI_PROVIDER,
        "overview": str(data.get("overview", "")).strip() or "—",
        "services": service_list("services"),
        "key_requirements": str_list("key_requirements"),
        "deliverables": str_list("deliverables"),
        "terms_and_deadlines": str_list("terms_and_deadlines"),
        "constraints": str_list("constraints"),
        "open_questions": str_list("open_questions"),
    }
