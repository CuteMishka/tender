# Tender — запуск и production

Проект состоит из **четырёх** сервисов:

| Сервис | Стек | Порт | Описание |
|--------|------|------|----------|
| **tenderai** | Go 1.22, Chi, GORM | `8082` | Основной бэкенд: API тендеров, аналитика, дашборд, заявки |
| **tender-rag** | Python, FastAPI, pgvector | `8083` | RAG-сервис: семантический поиск и AI-анализ тендеров |
| **tenderflow-admin** | React 19, Vite, TailwindCSS 4, TanStack Router | `5173` / `8080` | Фронтенд админ-панель |
| **parser** | Python, Playwright, SQLAlchemy | scheduled | Парсер площадок, загрузка документов, smart matching |

---

## Предварительные требования

- **Go** ≥ 1.22 → [go.dev/dl](https://go.dev/dl/)
- **Node.js** ≥ 20 + **npm** → [nodejs.org](https://nodejs.org/)
- **Docker** + **Docker Compose** → [docker.com](https://www.docker.com/)
- (Опционально) **Python** ≥ 3.11 — только если запускаете RAG без Docker

---

## Production quick start

Скопируйте env-шаблон:

```bash
cp .env.production.example .env
```

Заполните секреты и публичные URL:

```env
POSTGRES_PASSWORD=...
RAG_POSTGRES_PASSWORD=...
PUBLIC_BACKEND_URL=https://api.example.com
PUBLIC_RAG_URL=https://rag.example.com
CORS_ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
TENDERPLUS_TOKEN=...
GEMINI_API_KEY=...
```

Поднимите всю платформу:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up --build -d
```

Production compose поднимает frontend, backend, parser, tender-rag и две PostgreSQL БД. Parser работает через публичную страницу `zakup.gov.kz/home/lots` в Playwright-режиме и автоматически читает ключевые слова из backend справочника:

```env
DICTIONARIES_API_URL=http://backend:8082/api/v1/dictionaries?kind=keywords
```

Проверки:

```bash
curl http://localhost:8082/health
curl http://localhost:8082/api/v1/dictionaries?kind=keywords
curl http://localhost:8082/api/v1/parser/status
curl http://localhost:8083/health
```

---

## Справочник в production

Справочник больше не зависит только от `localStorage`.

- **Backend API**: `/api/v1/dictionaries`.
- **Frontend**: страница `/dictionaries` работает через API и сохраняет локальный fallback при недоступном backend.
- **Parser**: каждый цикл перечитывает активные `keywords` из backend API и автоматически использует новые слова.
- **Группы**: `keywords`, `advantages`, `blockers`, `tru`, `companies`.

Для локального parser `.env`:

```env
DICTIONARIES_API_URL=http://localhost:8082/api/v1/dictionaries?kind=keywords
```

---

## 1. Запуск PostgreSQL (для Go-бэкенда)

```bash
cd tenderai
docker compose up -d
```

Это поднимет Postgres 16 на порту **5433** (логин `tender`/`tender`, БД `tender`).

> Свой порт: `POSTGRES_PORT=5432 docker compose up -d`

---

## 2. Настройка переменных Go-бэкенда

Создайте файл `tenderai/.env`:

```env
# ── Обязательно ──
TENDERPLUS_TOKEN=ваш_токен_от_tenderplus

# ── Опционально (значения по умолчанию) ──
PORT=8082
TENDERPLUS_URL=https://api.tenderplus.kz/graphql
TENDERS_KEYWORDS=IaaS,сервер,хостинг

# Подключение к БД (по умолчанию — локальный Docker из шага 1)
LOCAL_DB_DSN=host=localhost user=tender password=tender dbname=tender port=5433 sslmode=disable TimeZone=Asia/Almaty

# CORS — фронт добавлен автоматически, доп. домены через запятую:
# CORS_ALLOWED_ORIGINS=https://tender.vercel.app

# Прокси скачивания документов (по умолчанию goszakup):
# FETCH_DOCUMENT_ALLOWED_HOSTS=v3bl.goszakup.gov.kz
```

> **Без `TENDERPLUS_TOKEN`** бэкенд стартует, но эндпоинт `/api/v1/tenders` вернёт `503`.

---

## 3. Запуск Go-бэкенда

```bash
cd tenderai
go run ./cmd/api
```

Проверка:

```bash
curl http://localhost:8082/health
```

При первом старте GORM выполнит `AutoMigrate` — таблицы `saved_lots`, `historical_lots`, `tracked_customers` создадутся автоматически.

---

## 4. Запуск RAG-сервиса (опционально)

RAG нужен для AI-анализа тендеров и индексации техспецификаций.

### a) Через Docker Compose (рекомендуется)

```bash
cd tender-rag
```

Создайте `tender-rag/.env`:

```env
GEMINI_API_KEY=ваш_ключ_google_ai_studio
CHAT_MODEL=gemini-2.5-flash
# COMPANY_PROFILE=текст профиля компании
```

Запуск:

```bash
docker compose up --build -d
```

Это поднимет:
- Postgres 16 + pgvector на порту **5437**
- API на порту **8083**

Проверка:

```bash
curl http://localhost:8083/health
```

---

## 5. Настройка и запуск фронтенда

```bash
cd tenderflow-admin
npm install
```

Создайте `tenderflow-admin/.env`:

```env
# Go-бэкенд (если на другом хосте/порту)
VITE_BACK_API=http://localhost:8082
VITE_LOCAL_API=http://localhost:8082

# RAG-сервис (если запущен)
VITE_RAG_API=http://localhost:8083

# Прокси для автозагрузки ТЗ из площадки
VITE_FETCH_DOCUMENT_PROXY_URL=http://localhost:8082/api/v1/fetch-document
```

> Если `.env` не создан, фронт по умолчанию обращается к `localhost:8082` для основного API и к продакшн-серверу для тендеров.

Запуск dev-сервера:

```bash
npm run dev
```

Фронтенд откроется на **http://localhost:5173**.

**Логин:** `admin` / `admin`

---

## 6. Сводка портов

| Порт | Сервис |
|------|--------|
| `5173` | Фронтенд (Vite dev server) |
| `8082` | Go-бэкенд |
| `8083` | RAG-сервис |
| `5433` | PostgreSQL (Go-бэкенд) |
| `5437` | PostgreSQL + pgvector (RAG) |

---

## 7. Полезные команды

```bash
# ── Билд Go-бэкенда ──
cd tenderai && go build -o server ./cmd/api

# ── Проверка типов фронтенда ──
cd tenderflow-admin && npx tsc --noEmit

# ── Продакшн-билд фронтенда ──
cd tenderflow-admin && npm run build

# ── Линтинг + форматирование ──
cd tenderflow-admin && npm run lint && npm run format

# ── Остановка всех Docker-контейнеров ──
cd tenderai && docker compose down
cd tender-rag && docker compose down
```

---

## 8. Структура проекта

```
tender1/
├── tenderai/                   # Go-бэкенд
│   ├── cmd/api/main.go         # Точка входа
│   ├── internal/
│   │   ├── api/                # HTTP-роутер, прокси документов
│   │   ├── analytics/          # Аналитика: модели, хендлеры
│   │   ├── config/             # Конфигурация из .env
│   │   ├── database/           # GORM + PostgreSQL
│   │   └── tenderplus/         # Клиент TenderPlus API, дашборд, заявки
│   ├── docker-compose.yml      # Локальный Postgres
│   └── .env                    # Секреты (не коммитить!)
│
├── tender-rag/                 # Python RAG-сервис
│   ├── docker-compose.yml      # Postgres+pgvector + API
│   ├── app/                    # FastAPI-приложение
│   └── .env                    # GEMINI_API_KEY и др.
│
├── tenderflow-admin/           # React-фронтенд
│   ├── src/
│   │   ├── routes/_admin/      # Страницы: тендеры, аналитика, заявки
│   │   ├── lib/                # API-клиенты (tenders-api, analytics-api)
│   │   ├── hooks/              # useTheme, useNotifications
│   │   └── components/admin/   # Sidebar, PageHeader, Toast
│   ├── .env                    # VITE_* переменные
│   └── package.json
│
└── render.yaml                 # Конфиг деплоя на Render
```

---

## Частые проблемы

| Проблема | Решение |
|----------|---------|
| `connection refused` на 5433 | Проверьте `docker compose up -d` в `tenderai/` |
| Тендеры возвращают 503 | Задайте `TENDERPLUS_TOKEN` в `tenderai/.env` |
| AI-анализ не работает | Убедитесь, что RAG запущен и `VITE_RAG_API` указан в `.env` фронта |
| «Автозагрузка ТЗ не работает» | Задайте `VITE_FETCH_DOCUMENT_PROXY_URL` |
| CORS-ошибки в браузере | Добавьте URL фронта в `CORS_ALLOWED_ORIGINS` бэкенда |
