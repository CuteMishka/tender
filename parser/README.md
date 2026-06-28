# TenderMachine V2 Parser

Модульный Python-парсер для мониторинга площадок, сохранения лотов в PostgreSQL, скачивания ТС и передачи документов в RAG.

## Возможности

- API-only мониторинг TenderPlus GraphQL без Playwright/Chromium;
- загрузка документов и технических спецификаций по ссылкам API;
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
STOP_WORDS_API_URL=http://localhost:8082/api/v1/dictionaries?kind=stop_words
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
PLATFORMS=tenderplus
DEFAULT_KEYWORDS=
DEFAULT_STOP_WORDS=
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

Для полной перепарсировки с очисткой сохранённых лотов:

```cmd
python main.py --once --clear-lots
```

## Ключевые слова

Парсер берёт активные ключевые слова из `DICTIONARIES_API_URL`, а активные стоп-слова из `STOP_WORDS_API_URL` или из того же URL справочника с заменой `kind=keywords` на `kind=stop_words`. Если API справочника недоступен, ключи берутся из таблицы `parser_keywords`, затем из `DEFAULT_KEYWORDS`; стоп-слова — из `DEFAULT_STOP_WORDS`.

`KEYWORDS_FILE_PATH` (`.xlsx`, `.csv`, `.tsv`, `.txt`) можно задать вручную для локального импорта, но в production его не задают, чтобы сайтовый справочник оставался единым источником.

`COLLECT_ALL_ACTIVE_LOTS=false` — основной режим для текущего проекта: TenderPlus получает запрос только с ключевыми словами, а во вкладку `Все` попадают только найденные по ним активные лоты.

`STRICT_KEYWORD_FILTER=true` дополнительно проверяет ответ TenderPlus локальным matcher-ом: если API вернул лот, но текст карточки не подтвердил совпадение с очищенными ключевыми словами Tender, лот не попадает во вкладку `Все`. При загрузке ключей также отбрасываются активные стоп-слова, чтобы такие позиции не затягивали выдачу.

Совпадения по ключевым словам сохраняются как контекст (`raw.keyword_match`, `raw.keyword_match_score`, `raw.keyword_match_method`, `raw.keyword_match_reason`) и передаются AI для семантической оценки.

`SMART_MATCH_USE_MORPHOLOGY=true` включает лемматизацию русского языка через `pymorphy3`: формы вроде `серверов`, `серверное`, `сервер` считаются совпадением по одной базовой форме.

`SEMANTIC_MATCH_ENABLED=false` по умолчанию выключен. Если установить `sentence-transformers` и включить этот флаг, парсер сможет сравнивать смысл текста лота и ключевых фраз через embeddings.

`AI_LOT_FILTER_ENABLED=true` включает локальную LLM через OpenAI-compatible endpoint (`GROQ_API_BASE`, по умолчанию Ollama `http://localhost:11434/v1`). Лот попадает во вкладку `Подходящие`, только если локальная LLM вернула `ai_score > 50`, `ai_passed=true` и `ai_provider=local-llm`.

`AI_REQUIRE_SPEC_TEXT=true` делает техническую спецификацию обязательной для финального AI-решения. Парсер сначала скачивает и читает наиболее похожий на ТС документ (`TENDERPLUS_DOCUMENT_MAX_DOWNLOADS=1` в production), сохраняет текст/статус в `raw.spec_*`, затем проверяет в ТС сильные инфраструктурные сигналы и только после этого передаёт LLM релевантные фрагменты ТС. Если ТС не скачалась, не распозналась, не содержит текста или в ней нет признаков облачной/дата-центровой услуги, лот остаётся во вкладке `Все`, но не попадает в `Подходящие`.

Профиль Tender в AI-промпте ориентирован на OpenNebula, VMware, виртуальный ЦОД/VDC, IaaS, VPS/VDS, Private Tender, аренду серверных и вычислительных мощностей, ЦОД/colocation, СХД, хранение данных, Backup/BaaS, DRaaS и поддержку облачной инфраструктуры. Обычная поставка техники или товаров без облачной/дата-центровой услуги должна получать непроходную оценку.

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
5. Добавьте имя API-платформы в `.env`: `PLATFORMS=tenderplus`.

## Важное ограничение

Текущий финальный режим парсера: `PLATFORMS=tenderplus`. Браузерные адаптеры отключены в сборке, новые тендеры и документы берутся через TenderPlus API.
