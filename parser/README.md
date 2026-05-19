# TenderMachine V2 Parser

Модульный Python-парсер для мониторинга площадок, сохранения лотов в PostgreSQL, скачивания ТС и передачи документов в RAG.

## Возможности

- многопоточный цикл мониторинга публичной страницы `zakup.gov.kz/home/lots` через Playwright каждые 30 минут;
- Playwright для динамических страниц;
- сбор всех активных лотов без вышедшего дедлайна и отдельная маркировка подходящих по ключам;
- умное определение подходящих лотов: exact match, лемматизация `pymorphy3`, опциональные embeddings и LLM-фильтр;
- PostgreSQL-хранилище с защитой от дублей по `source + external_id`;
- таблицы для ключевых слов, документов, запусков и уведомлений;
- скачивание PDF/DOC/DOCX технических спецификаций;
- отправка документов в RAG endpoint `/v1/lots/{lot_id}/index-document`;
- отслеживание изменений лота, документов, жалоб и победителя;
- сравнение БИН победителя с `OUR_BINS`;
- адаптерная архитектура для новых площадок.

## Структура

```text
parser/
├── main.py
├── requirements.txt
├── .env.example
├── migrations/001_init.sql
└── tender_parser/
    ├── config.py
    ├── db.py
    ├── documents.py
    ├── fingerprints.py
    ├── keywords.py
    ├── logging_config.py
    ├── notifications.py
    ├── protocols.py
    ├── rag.py
    ├── retry.py
    ├── scheduler.py
    ├── schemas.py
    ├── text_extract.py
    └── platforms/
        ├── base.py
        ├── zakup.py
        ├── zakup_ows.py
        ├── goszakup.py
        ├── samruk.py
        └── utils.py
```

## Установка

```cmd
cd C:\Users\user\Desktop\tender1\parser
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
```

## Настройка

Скопируйте `.env.example` в `.env`:

```cmd
copy .env.example .env
```

Минимально проверьте:

```env
DATABASE_URL=postgresql+psycopg://tender:tender@localhost:5433/tender
RAG_API_BASE=http://localhost:8083
DICTIONARIES_API_URL=http://localhost:8082/api/v1/dictionaries?kind=keywords
POLL_INTERVAL_SECONDS=1800
MAX_WORKERS=4
STRICT_KEYWORD_FILTER=false
COLLECT_ALL_ACTIVE_LOTS=true
SMART_MATCH_ENABLED=true
SMART_MATCH_USE_MORPHOLOGY=true
SEMANTIC_MATCH_ENABLED=false
AI_LOT_FILTER_ENABLED=false
STOP_AT_FIRST_SEEN_LOT=false
PROCESS_EXISTING_LOTS=true
MAX_LOTS_PER_CYCLE=0
PLATFORMS=zakup
DEFAULT_KEYWORDS=
ZAKUP_PUBLIC_BASE_URL=https://zakup.gov.kz
ZAKUP_LOTS_URL=https://zakup.gov.kz/home/lots
ZAKUP_LOTS_LIMIT=100
ZAKUP_LOTS_MAX_PAGES=0
ZAKUP_LOTS_SYSTEM_IDS=1__2__3
OUR_BINS=123456789012
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

PostgreSQL можно использовать тот же, что и `tenderai`:

```cmd
cd C:\Users\user\Desktop\tender1\tenderai
docker compose up -d
```

RAG должен быть доступен на `http://localhost:8083`, если нужно индексировать ТС.

## Запуск

```cmd
cd C:\Users\user\Desktop\tender1\parser
.venv\Scripts\activate
python main.py
```

Парсер сам создаст таблицы через SQLAlchemy `create_all`.

Для разового тестового прогона без вечного цикла:

```cmd
python main.py --once
```

## Ключевые слова

Парсер каждый цикл пытается загрузить активные ключи из `DICTIONARIES_API_URL`. Если пользователь добавит слово в справочник `/dictionaries`, следующий 30-минутный цикл автоматически возьмёт обновлённый список. Если backend справочника недоступен или вернул пустой список, parser использует таблицу `parser_keywords`, а затем fallback `DEFAULT_KEYWORDS`.

`COLLECT_ALL_ACTIVE_LOTS=true` включает новый основной режим: parser сохраняет все активные лоты, у которых дедлайн ещё не вышел, проходя по страницам закупок через `limit + offset`. Лоты не отбрасываются по ключевым словам.

`STRICT_KEYWORD_FILTER=false` нужен для режима всех активных лотов. Совпадения по ключевым словам сохраняются только как контекст (`raw.keyword_match`, `raw.keyword_match_score`, `raw.keyword_match_method`, `raw.keyword_match_reason`) и передаются AI для семантической оценки. Вкладка `Подходящие` использует только результат AI `raw.is_suitable=true`.

`SMART_MATCH_USE_MORPHOLOGY=true` включает лемматизацию русского языка через `pymorphy3`: формы вроде `серверов`, `серверное`, `сервер` считаются совпадением по одной базовой форме.

`SEMANTIC_MATCH_ENABLED=false` по умолчанию выключен. Если установить `sentence-transformers` и включить этот флаг, парсер сможет сравнивать смысл текста лота и ключевых фраз через embeddings.

`AI_LOT_FILTER_ENABLED=false` по умолчанию выключен. Если включить, parser будет отправлять текст лота в `tender-rag` endpoint `/v1/lot/analyze` и сохранять результат в `raw.ai_filter`, `raw.ai_score`, `raw.ai_passed`.

`STOP_AT_FIRST_SEEN_LOT=false`, `PROCESS_EXISTING_LOTS=true` и `MAX_LOTS_PER_CYCLE=0` нужны для полного обновления активной выдачи: parser не останавливается на первом уже известном лоте, проходит все страницы до пустой страницы или до лимита `ZAKUP_LOTS_MAX_PAGES`.

`ZAKUP_LOTS_LIMIT=100` берёт максимум лотов за страницу, `ZAKUP_LOTS_MAX_PAGES=0` означает без фиксированного лимита страниц. Если площадка начнёт отдавать слишком много данных или запуск в GitHub Actions не успевает, временно задайте, например, `ZAKUP_LOTS_MAX_PAGES=20`.

## Telegram-уведомления

1. Создайте бота через `@BotFather` и получите token.
2. Напишите своему боту любое сообщение.
3. Откройте `https://api.telegram.org/bot<token>/getUpdates` и возьмите `chat.id`.
4. Заполните `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:telegram-token
TELEGRAM_CHAT_ID=123456789
```

Telegram-сообщение отправляется только для нового подходящего лота после успешного `upsert_lot`. Неподходящие активные лоты сохраняются в базу, но не отправляются в Telegram, не скачивают документы и не отправляются в RAG. Если переменные пустые, parser продолжает работать без Telegram.

```sql
INSERT INTO parser_keywords(value, active)
VALUES ('SOC', true), ('SIEM', true)
ON CONFLICT (value) DO UPDATE SET active = EXCLUDED.active;
```

## Где смотреть результаты

```sql
SELECT * FROM parser_lots ORDER BY updated_at DESC;
SELECT * FROM parser_documents ORDER BY updated_at DESC;
SELECT * FROM parser_notifications ORDER BY created_at DESC;
SELECT * FROM parser_runs ORDER BY started_at DESC;
```

## Добавление новой площадки

1. Создайте файл в `tender_parser/platforms/new_platform.py`.
2. Унаследуйте класс от `TenderPlatform`.
3. Реализуйте `search`, `enrich`, `load_final_protocol`.
4. Зарегистрируйте адаптер в `tender_parser/platforms/__init__.py`.
5. Добавьте имя площадки в `.env`: `PLATFORMS=zakup,new_platform`.

## Важное ограничение

Основной адаптер `zakup` работает без OWS-токена через Playwright и публичный route `/home/lots?limit=100&offset=0&ord=undefined&system_id__in=1__2__3`. Если позже появится OWS-токен, отдельный режим `PLATFORMS=zakup_ows` оставлен в проекте; он тоже поддерживает режим `COLLECT_ALL_ACTIVE_LOTS=true`.
