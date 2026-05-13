# TenderMachine V2 Parser

Модульный Python-парсер для мониторинга площадок, сохранения лотов в PostgreSQL, скачивания ТС и передачи документов в RAG.

## Возможности

- многопоточный цикл мониторинга каждые 5 минут;
- Playwright для динамических страниц;
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
POLL_INTERVAL_SECONDS=300
MAX_WORKERS=4
PLATFORMS=goszakup,samruk
DEFAULT_KEYWORDS=кибербезопасность,ОЦИБ,EDR,пентест,аудит безопасности,сервер,облако,виртуализация,backup
OUR_BINS=123456789012
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

При первом запуске парсер создаёт `parser_keywords` из `DEFAULT_KEYWORDS`. Далее можно управлять словами SQL-запросом:

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
5. Добавьте имя площадки в `.env`: `PLATFORMS=goszakup,samruk,new_platform`.

## Важное ограничение

Селекторы публичных порталов часто меняются. `goszakup` и `samruk/zakupki.kz` сделаны устойчивыми за счёт универсальных селекторов и regex, но после первого живого запуска стоит уточнить селекторы под фактическую HTML-разметку текущего портала.
