"""Stateless tender-document chat for Cloudy."""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from typing import Any, Sequence

from app.chunking import chunk_text
from app.config import AI_PROVIDER, CHAT_MODEL, ai_chat
from app.document_extract import extract_text_from_bytes

MAX_PROMPT_CHARS = 30_000
MAX_HISTORY_MESSAGES = 10
MAX_SNIPPETS = 10
MAX_SNIPPETS_PER_DOC = 3
MAX_CHUNKS_PER_DOC = 180

# ── Intent classification ──────────────────────────────────────────────────────

INTENT_GREETING = "greeting"
INTENT_SMALLTALK = "smalltalk"
INTENT_THANKS = "thanks"
INTENT_DOCUMENT_QUESTION = "document_question"

_GREETING_PATTERNS = re.compile(
    r"^\s*(?:"
    r"привет(?:ик|ики|ствую|ствуйте)?|здравствуй(?:те)?|добр(?:ый|ое|ая)\s+(?:день|утро|вечер)"
    r"|хай|хелло|hello|hi|hey|салам|здаров|здарова|йоу|yo"
    r"|доброго\s+(?:дня|утра|вечера|времени)"
    r")\s*[!.?]*\s*$",
    re.IGNORECASE,
)

_THANKS_PATTERNS = re.compile(
    r"^\s*(?:"
    r"спасибо|благодарю|спс|thanks?|thx|мерси|пасиб|благодарствую"
    r"|отлично[,!\s]*спасибо|хорошо[,!\s]*спасибо|ок[,!\s]*спасибо"
    r"|круто|класс|супер|молодец|отлично|замечательно|великолепно|прекрасно"
    r")\s*[!.?]*\s*$",
    re.IGNORECASE,
)

_SMALLTALK_PATTERNS = re.compile(
    r"^\s*(?:"
    r"кто\s+ты|что\s+ты\s+(?:умеешь|можешь|делаешь|такое)"
    r"|как\s+(?:тебя\s+зовут|ты\s+работаешь|ты\s+можешь\s+помочь)"
    r"|что\s+(?:ты\s+за\s+бот|такое\s+cloudy)"
    r"|расскажи\s+о\s+себе|помоги|помощь|help"
    r")\s*[!.?]*\s*$",
    re.IGNORECASE,
)

_GREETING_RESPONSES = [
    "Привет! 👋 Я Cloudy — AI-помощник по тендерным документам. Задайте вопрос по выбранному лоту, и я найду ответ в документах.",
    "Здравствуйте! 👋 Я готов помочь с анализом тендерных документов. Спрашивайте — я найду ответ в ваших ТС.",
    "Привет! Рад помочь! 🙌 Задайте вопрос по лоту — я проанализирую документы и дам ответ с источниками.",
]

_THANKS_RESPONSES = [
    "Пожалуйста! 😊 Если будут ещё вопросы по лоту — спрашивайте.",
    "Рад помочь! Если нужно уточнить что-то ещё по документам — я здесь.",
    "Обращайтесь! 👍 Готов помочь с другими вопросами по тендеру.",
]

_SMALLTALK_RESPONSES = [
    "Я Cloudy — AI-помощник по тендерам. 🤖 Я анализирую документы лота (ТС, приложения, контракты) и отвечаю на вопросы по ним. Спросите, например, про сроки, бюджет или требования.",
    "Я помощник для тендерных специалистов. Загрузите документы лота, и я смогу ответить на вопросы по срокам, требованиям, лицензиям и другим деталям ТС.",
]

_DEFAULT_FOLLOW_UP = [
    "Какой срок подачи заявки?",
    "Какая сумма и валюта закупки?",
    "Какие ключевые требования по ТС?",
]


def classify_intent(question: str, history: Sequence[dict[str, Any]] | None = None) -> str:
    """Classify user intent without calling LLM.

    Returns one of: INTENT_GREETING, INTENT_THANKS, INTENT_SMALLTALK, INTENT_DOCUMENT_QUESTION
    """
    q = question.strip()
    if not q:
        return INTENT_DOCUMENT_QUESTION
    # Only classify short messages as non-document intents
    if len(q) > 120:
        return INTENT_DOCUMENT_QUESTION
    if _GREETING_PATTERNS.match(q):
        return INTENT_GREETING
    if _THANKS_PATTERNS.match(q):
        return INTENT_THANKS
    if _SMALLTALK_PATTERNS.match(q):
        return INTENT_SMALLTALK
    return INTENT_DOCUMENT_QUESTION


def _instant_response(intent: str) -> dict[str, Any]:
    """Generate an instant response for non-document intents."""
    if intent == INTENT_GREETING:
        answer = random.choice(_GREETING_RESPONSES)
    elif intent == INTENT_THANKS:
        answer = random.choice(_THANKS_RESPONSES)
    elif intent == INTENT_SMALLTALK:
        answer = random.choice(_SMALLTALK_RESPONSES)
    else:
        answer = "Привет! Задайте вопрос по документам лота."

    return {
        "answer": answer,
        "sources": [],
        "follow_up": _DEFAULT_FOLLOW_UP,
        "used_documents": [],
        "warnings": [],
        "provider": "built-in",
        "model": "intent-router",
        "intent": intent,
    }

QUESTION_STOP_WORDS = {
    "а",
    "без",
    "в",
    "во",
    "где",
    "для",
    "до",
    "и",
    "или",
    "как",
    "какая",
    "какие",
    "какой",
    "когда",
    "на",
    "надо",
    "нужно",
    "о",
    "об",
    "от",
    "по",
    "при",
    "с",
    "со",
    "что",
    "это",
}

DOMAIN_HINTS = {
    "деньги": ("цена", "стоимость", "сумма", "бюджет", "тенге", "kzt", "ндс"),
    "срок": ("срок", "дата", "поставка", "исполнение", "календар", "рабоч"),
    "документы": ("документ", "сертификат", "лиценз", "декларац", "справк"),
    "требования": ("требован", "характерист", "параметр", "услов", "техническ"),
}

SYSTEM_CLOUDY = """Ты Cloudy, помощник по тендерам и техническим спецификациям.
Ты отвечаешь на вопросы пользователя только по карточке лота, выбранным документам и истории текущего диалога.

Источники данных и их приоритет:
- Для структурированных полей лота — сумма/бюджет, срок ПОДАЧИ заявки, заказчик, организатор,
  регион, статус, тип закупки — в первую очередь используй «Карточку лота». Это официальные
  поля площадки, они точнее, чем разрозненные упоминания в документах.
- Для технических требований, характеристик, условий поставки, гарантий, штрафов и лицензий —
  используй текст выбранных документов и «Структурированную выжимку ТС».

Различай типы сроков и не путай их:
- «Срок подачи заявки» / «окончание приёма заявок» — это поле «Окончание подачи» из карточки лота.
- «Срок поставки» / «срок исполнения договора» / «срок оказания услуг» — это условие из договора
  или ТС, оно НЕ равно сроку подачи заявки.
- «Срок оплаты» — отдельное условие из договора.
Если пользователь спросил про срок, уточни в ответе, о каком именно сроке идёт речь, и приводи
значение из правильного источника.

Правила:
- Не выдумывай сроки, суммы, требования, лицензии, штрафы и условия.
- Если ответа нет в выбранных документах или карточке лота, так и скажи прямо.
- Если в карточке и документах данные расходятся, укажи оба значения и поясни, откуда каждое.
- Если вопрос неоднозначен, задай короткий уточняющий вопрос.
- Пиши по-русски, понятно для тендерного специалиста. Суммы указывай с валютой.
- Ссылайся на документы по их названиям, если используешь фрагменты из них.
- Не обещай победу, допуск или юридическую корректность.

Ответ строго JSON без markdown:
{
  "answer": "ответ пользователю",
  "sources": [
    {"document": "имя документа", "snippet": "короткий подтверждающий фрагмент"}
  ],
  "follow_up": ["необязательные уточняющие вопросы"]
}
"""


@dataclass(frozen=True)
class CloudyDocument:
    name: str
    text: str


@dataclass(frozen=True)
class CloudySnippet:
    document: str
    chunk_index: int
    text: str
    score: float


def _clean_text(value: Any, limit: int = 4000) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    if len(text) <= limit:
        return text
    return text[: limit - 24].rstrip() + "\n… [обрезано]"


def _safe_doc_name(name: str, index: int) -> str:
    value = " ".join(str(name or "").split())
    return value or f"document-{index + 1}"


def extract_cloudy_documents(files: Sequence[tuple[str, bytes]]) -> tuple[list[CloudyDocument], list[str]]:
    documents: list[CloudyDocument] = []
    warnings: list[str] = []
    for index, (name, data) in enumerate(files):
        doc_name = _safe_doc_name(name, index)
        if not data:
            warnings.append(f"{doc_name}: пустой файл")
            continue
        try:
            text = extract_text_from_bytes(doc_name, data)
        except Exception as exc:
            warnings.append(f"{doc_name}: не удалось прочитать ({exc})")
            continue
        text = _clean_text(text, 180_000)
        if not text:
            warnings.append(f"{doc_name}: текст не найден")
            continue
        documents.append(CloudyDocument(name=doc_name, text=text))
    return documents, warnings


def _fallback_snippets(documents: Sequence[CloudyDocument]) -> list[CloudySnippet]:
    snippets: list[CloudySnippet] = []
    for doc in documents[:MAX_SNIPPETS]:
        chunks = chunk_text(doc.text, max_chars=1600, overlap=150)
        if chunks:
            snippets.append(CloudySnippet(doc.name, 0, chunks[0], 0.0))
    return snippets[:MAX_SNIPPETS]


def _tokenize_for_rank(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]{3,}", text.lower())
        if token not in QUESTION_STOP_WORDS
    ]


def _expanded_question_terms(question: str) -> set[str]:
    terms = set(_tokenize_for_rank(question))
    lowered = question.lower()
    for trigger, hints in DOMAIN_HINTS.items():
        if trigger in lowered or any(trigger.startswith(term) or term.startswith(trigger) for term in terms):
            terms.update(hints)
    return terms


def _lexical_score(question_terms: set[str], chunk: str, chunk_index: int) -> float:
    if not question_terms:
        return 1.0 / float(chunk_index + 1)

    lowered = chunk.lower()
    chunk_tokens = _tokenize_for_rank(chunk)
    if not chunk_tokens:
        return 0.0

    chunk_token_set = set(chunk_tokens)
    overlap = question_terms & chunk_token_set
    partial = sum(1 for term in question_terms if len(term) >= 5 and any(token.startswith(term) or term in token for token in chunk_token_set))
    phrase_hits = sum(1 for term in question_terms if term in lowered)

    score = float(len(overlap) * 5 + partial * 2 + phrase_hits)
    score += 1.0 / float(chunk_index + 1)
    return score


def select_relevant_snippets(question: str, documents: Sequence[CloudyDocument]) -> list[CloudySnippet]:
    if not documents:
        return []

    candidates: list[CloudySnippet] = []
    question_terms = _expanded_question_terms(question)

    for doc in documents:
        chunks = chunk_text(doc.text, max_chars=1600, overlap=180)[:MAX_CHUNKS_PER_DOC]
        if not chunks:
            continue
        ranked = sorted(
            (
                CloudySnippet(
                    document=doc.name,
                    chunk_index=index,
                    text=chunk,
                    score=_lexical_score(question_terms, chunk, index),
                )
                for index, chunk in enumerate(chunks)
            ),
            key=lambda item: item.score,
            reverse=True,
        )
        candidates.extend([snippet for snippet in ranked if snippet.score > 0][:MAX_SNIPPETS_PER_DOC])

    if not candidates:
        return _fallback_snippets(documents)

    seen: set[tuple[str, int]] = set()
    unique: list[CloudySnippet] = []
    for item in sorted(candidates, key=lambda snippet: snippet.score, reverse=True):
        key = (item.document, item.chunk_index)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= MAX_SNIPPETS:
            break
    return unique


def normalize_history(history: Sequence[dict[str, Any]] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in list(history or [])[-MAX_HISTORY_MESSAGES:]:
        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = _clean_text(item.get("content"), 1200)
        if content:
            out.append({"role": role, "content": content})
    return out


def _format_history(history: Sequence[dict[str, str]]) -> str:
    if not history:
        return "Истории нет: это первый вопрос в текущем открытии чата."
    lines: list[str] = []
    for item in history:
        label = "Пользователь" if item["role"] == "user" else "Cloudy"
        lines.append(f"{label}: {item['content']}")
    return "\n".join(lines)


def _format_spec_summary(spec_summary: dict[str, Any] | None) -> str:
    if not spec_summary:
        return "Нет готовой структурированной выжимки."
    return _clean_text(json.dumps(spec_summary, ensure_ascii=False, indent=2), 8000)


def build_cloudy_prompt(
    *,
    question: str,
    lot_context: str,
    history: Sequence[dict[str, Any]] | None,
    documents: Sequence[CloudyDocument],
    snippets: Sequence[CloudySnippet],
    spec_summary: dict[str, Any] | None = None,
    warnings: Sequence[str] | None = None,
) -> str:
    document_catalog = "\n".join(
        f"{index + 1}. {doc.name} ({len(doc.text)} символов текста)"
        for index, doc in enumerate(documents)
    ) or "Документы не переданы; отвечай только по карточке лота."

    snippet_text = "\n\n".join(
        (
            f"[{index + 1}] Документ: {snippet.document}; "
            f"chunk={snippet.chunk_index}; score={snippet.score:.4f}\n"
            f"{_clean_text(snippet.text, 2200)}"
        )
        for index, snippet in enumerate(snippets)
    ) or "Релевантные фрагменты не найдены."

    warning_text = "\n".join(f"- {warning}" for warning in warnings or []) or "Нет."

    prompt = f"""### Карточка лота
{_clean_text(lot_context, 8000) or "Карточка лота не передана."}

### Структурированная выжимка ТС
{_format_spec_summary(spec_summary)}

### Выбранные документы
{document_catalog}

### Предупреждения по чтению документов
{warning_text}

### История текущего диалога
{_format_history(normalize_history(history))}

### Текущий вопрос пользователя
{_clean_text(question, 2500)}

### Релевантные фрагменты из выбранных документов
{snippet_text}

Сформируй ответ только по этим данным. Если факта нет, не предполагай его.
"""
    return _clean_text(prompt, MAX_PROMPT_CHARS)


def _source_from_snippet(snippet: CloudySnippet) -> dict[str, Any]:
    return {
        "document": snippet.document,
        "snippet": _clean_text(snippet.text, 500),
        "score": round(snippet.score, 4),
    }


def _normalize_sources(raw: Any, snippets: Sequence[CloudySnippet]) -> list[dict[str, Any]]:
    snippet_sources = [_source_from_snippet(snippet) for snippet in snippets[:5]]
    if snippet_sources:
        selected: list[dict[str, Any]] = []
        used_indexes: set[int] = set()
        if isinstance(raw, list):
            for item in raw:
                if not isinstance(item, dict):
                    continue
                document = str(item.get("document") or item.get("source") or item.get("file") or "").strip()
                if not document:
                    continue
                for index, source in enumerate(snippet_sources):
                    if index in used_indexes:
                        continue
                    if source["document"].casefold() == document.casefold():
                        selected.append(source)
                        used_indexes.add(index)
                        break
                if len(selected) >= 5:
                    return selected
        for index, source in enumerate(snippet_sources):
            if index not in used_indexes:
                selected.append(source)
            if len(selected) >= 5:
                return selected
        return selected

    out: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            document = str(item.get("document") or item.get("source") or item.get("file") or "").strip()
            snippet = str(item.get("snippet") or item.get("quote") or item.get("text") or "").strip()
            if document and snippet:
                out.append({"document": document, "snippet": _clean_text(snippet, 500)})
            if len(out) >= 5:
                return out

    return out


def _normalize_follow_up(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [_clean_text(item, 200) for item in raw if _clean_text(item, 200)][:3]
    if isinstance(raw, str) and raw.strip():
        return [_clean_text(raw, 200)]
    return []


def _strip_json_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[-1] if cleaned.count("```") >= 2 else cleaned
        cleaned = cleaned.lstrip("json").strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()
    return cleaned


def _first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def parse_cloudy_ai_response(text: str) -> dict[str, Any]:
    cleaned = _strip_json_fence(text)
    for candidate in (cleaned, _first_json_object(cleaned)):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data
    return {"answer": _clean_text(text, 6000), "sources": [], "follow_up": []}


def _short_error(exc: Exception) -> str:
    return _clean_text(str(exc) or exc.__class__.__name__, 240)


def _fallback_answer_from_snippets(
    *,
    question: str,
    lot_context: str,
    snippets: Sequence[CloudySnippet],
    error: Exception,
) -> str:
    lines = [
        "Полноценный AI-ответ временно недоступен, но я нашёл релевантные данные в доступных источниках.",
    ]
    if snippets:
        lines.append("Фрагменты, которые стоит проверить:")
        for snippet in snippets[:3]:
            quote = " ".join(_clean_text(snippet.text, 350).split())
            lines.append(f"- {snippet.document}: {quote}")
    elif lot_context.strip():
        lines.append("Документы не дали читаемых фрагментов, поэтому можно опираться только на карточку лота.")
        lines.append(_clean_text(lot_context, 1200))
    else:
        lines.append("В выбранных документах не удалось получить читаемый текст.")
    lines.append(f"Техническая причина: {_short_error(error)}")
    return _clean_text("\n".join(lines), 6000)


def answer_cloudy_question(
    *,
    question: str,
    lot_context: str,
    history: Sequence[dict[str, Any]] | None,
    documents: Sequence[CloudyDocument],
    spec_summary: dict[str, Any] | None = None,
    warnings: Sequence[str] | None = None,
) -> dict[str, Any]:
    question = _clean_text(question, 2500)
    if not question:
        raise ValueError("question is empty")

    # ── Intent routing: skip document processing for greetings/smalltalk ──
    intent = classify_intent(question, history)
    if intent != INTENT_DOCUMENT_QUESTION:
        return _instant_response(intent)

    # ── Full document pipeline for real questions ──
    snippets = select_relevant_snippets(question, documents)
    prompt = build_cloudy_prompt(
        question=question,
        lot_context=lot_context,
        history=history,
        documents=documents,
        snippets=snippets,
        spec_summary=spec_summary,
        warnings=warnings,
    )
    try:
        raw_answer = ai_chat(
            SYSTEM_CLOUDY,
            prompt,
            temperature=0.15,
            provider=AI_PROVIDER,
            model=CHAT_MODEL,
        )
    except Exception as exc:
        fallback_warnings = list(warnings or [])
        fallback_warnings.append(f"AI временно недоступен: {_short_error(exc)}")
        return {
            "answer": _fallback_answer_from_snippets(
                question=question,
                lot_context=lot_context,
                snippets=snippets,
                error=exc,
            ),
            "sources": _normalize_sources(None, snippets),
            "follow_up": _DEFAULT_FOLLOW_UP,
            "used_documents": [doc.name for doc in documents],
            "warnings": fallback_warnings,
            "provider": AI_PROVIDER,
            "model": CHAT_MODEL,
        }
    data = parse_cloudy_ai_response(raw_answer)
    if not isinstance(data, dict):
        raise RuntimeError("AI returned non-object JSON")

    answer = _clean_text(data.get("answer") or data.get("summary") or data.get("message"), 6000)
    if not answer:
        answer = "В выбранных документах не удалось найти подтвержденный ответ."
    return {
        "answer": answer,
        "sources": _normalize_sources(data.get("sources"), snippets),
        "follow_up": _normalize_follow_up(data.get("follow_up")),
        "used_documents": [doc.name for doc in documents],
        "warnings": list(warnings or []),
        "provider": AI_PROVIDER,
        "model": CHAT_MODEL,
    }
