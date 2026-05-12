# Аудит функционала Tender

Дата аудита: 2026-05-12

## Легенда статусов

- `Готово` — функционал реализован и базовые проверки сборки/типизации проходят.
- `Работает с ограничениями` — функционал доступен, но есть внешние зависимости, демо-данные или UX/интеграционные ограничения.
- `Есть баги` — функционал частично реализован, но обнаружены проблемы.
- `В реализации` — есть код/заготовки, но нет полного пользовательского сценария.
- `Планируется` — логически нужен продукту, но сейчас не завершён.

## Frontend: tenderflow-admin

| Функция | Раздел | Уровень завершения | Проверка | Статус/заметки |
|---|---|---:|---|---|
| Дашборд заявок и сумм | `/dashboard` | 80% | Сборка TypeScript | Работает с ограничениями: зависит от локального Go API и сохранённых лотов. |
| Список тендеров | `/tenders` | 85% | Сборка TypeScript | Работает. Поиск отправляется в backend через `keywords`; локальные вкладки и сумма фильтруют загруженную страницу. |
| Поиск по названию/заказчику/виду закупки | `/tenders` | 80% | Кодовая проверка + TypeScript | Исправлено. Запросы вроде `Государственные закупки` не должны скрывать тендеры локально. Релевантность зависит от TenderPlus API. |
| Вкладки тендеров | `/tenders` | 75% | TypeScript | Работают локально: все, активные, истекающие, завершённые, наше участие. Ограничение: фильтрация после получения страницы. |
| Детальная карточка тендера | `/tenders/$tenderId` | 80% | TypeScript | Работает с fallback-поиском по TenderPlus. |
| Сохранение решения по тендеру | `/tenders`, `/tenders/$tenderId` | 85% | TypeScript + Go build | Работает: сохраняет статус `participating`/`rejected`, компанию и ссылку. |
| AI-анализ лота | `/tenders/$tenderId` + RAG | 75% | Python compile | Работает с ограничениями: теперь поддерживает `AI_PROVIDER=groq` и старый Gemini fallback. Требуется ключ в `.env`. Есть кэш/anti-repeat защита. |
| Индексация документа лота | `/tenders/$tenderId` + RAG | 70% | Python compile | Работает с ограничениями: PDF/DOCX без OCR; AI-выжимка требует ключ. |
| Заявки | `/bids` | 85% | TypeScript | Работает: вкладки, переход в тендер, поиск, явная кнопка удаления. |
| Удаление заявки | `/bids` | 90% | TypeScript + Go build | Работает через `DELETE /api/v1/lots/saved/{id}`. |
| Уведомления | `/notifications` | 75% | TypeScript | Работают в localStorage; добавлен поиск. Ограничение: нет серверной синхронизации. |
| Справочники парсера | `/dictionaries` | 75% | TypeScript | Работают в localStorage; добавлен поиск, CRUD и CSV. Ограничение: не подключены к backend-парсеру. |
| Компании | `/companies` | 45% | TypeScript | Демо-реестр; добавлен поиск. Нет backend CRUD. |
| Пользователи | `/users` | 45% | TypeScript | Демо-таблица; добавлен поиск. Backend users временно отключён. |
| Настройки | `/settings` | 35% | TypeScript | UI-заготовка, без реального сохранения в backend. |

## Analytics

| Функция | Раздел/API | Уровень завершения | Проверка | Статус/заметки |
|---|---|---:|---|---|
| История тендеров | `/analytics/historical` | 85% | TypeScript + Go build | Работает: синхронизация, таблица, редактирование результата, фильтры. |
| Универсальный поиск истории | `/api/v1/analytics/lots` | 90% | Go build | Исправлено: ищет по заказчику, организатору, названию, описанию, виду закупки, региону, победителю. |
| Фильтр “только наше участие” | `/analytics/historical` | 80% | Go build | Работает по статусам участия. |
| Заказчики из истории | `/analytics/customers` | 85% | TypeScript + Go build | Работает: кандидаты из истории, добавление в отслеживаемые, избранное. |
| Прошлые заказы заказчика | `/analytics/customers` | 85% | TypeScript + Go build | Исправлено: есть раскрытие истории по кандидатам и по отслеживаемым заказчикам. |
| Удаление заказчика | `/analytics/customers` | 90% | Go build | Работает через `DELETE /api/v1/analytics/customers/{id}`. |
| Аналитика победителей | `/analytics/winners` | 80% | TypeScript | Работает; добавлен frontend-поиск по победителю и метрикам. |
| Анализ цен | `/analytics/prices` | 80% | TypeScript | Работает; добавлен frontend-поиск по контрактам. Ограничение: данные появляются после внесения контрактов. |
| CSV экспорт истории | `/api/v1/analytics/export` | 70% | Go build | Работает, но экспортирует последние 5000 строк без применения текущих UI-фильтров. |

## Backend: tenderai

| Функция | API | Уровень завершения | Проверка | Статус/заметки |
|---|---|---:|---|---|
| TenderPlus GraphQL client | `internal/tenderplus` | 75% | Go build | Работает для списка и детального поиска; зависит от внешнего API и токена. |
| Список тендеров | `GET /api/v1/tenders` | 80% | Go build | Работает. При ошибке TenderPlus отдаёт demo fallback. |
| Детальный тендер | `GET /api/v1/tenders/{id}` | 75% | Go build | Работает через перебор страниц; может быть медленно. |
| Сохранённые лоты | `/api/v1/lots/saved` | 85% | Go build | Работает: list/create/delete. |
| Дашборд | `/api/v1/dashboard` | 80% | Go build | Работает по таблице `saved_lots`. |
| Аналитика истории | `/api/v1/analytics/*` | 85% | Go build | Работает: sync, lots, stats, dynamics, filters, customers, winners, prices. |
| Users API | `/api/v1/users` | 20% | Кодовая проверка | Есть доменная заготовка, но в `cmd/api/main.go` users временно не регистрируется. |

## Backend: tender-rag

| Функция | API/модуль | Уровень завершения | Проверка | Статус/заметки |
|---|---|---:|---|---|
| Healthcheck | `GET /health` | 90% | Python compile | Работает; теперь показывает `ai.provider`, `ai.model`, `configured`, без раскрытия ключа. |
| AI provider selection | `app/config.py` | 85% | Python compile | Добавлено: `AI_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_BASE_URL`, OpenAI-compatible Groq. Gemini fallback сохранён. |
| Lot analyze | `POST /v1/lot/analyze` | 80% | Python compile | Работает при наличии AI-ключа и профиля компании. |
| Match analyze | `POST /v1/match/analyze` | 75% | Python compile | Работает с pgvector и AI. Ограничение: нужна заполненная база индекса. |
| Index text | `POST /v1/lots/{id}/index` | 80% | Python compile | Работает для текста. |
| Index document | `POST /v1/lots/{id}/index-document` | 75% | Python compile | Работает для PDF/DOCX; нет OCR. |
| Specification summary | `/spec-summary` | 75% | Python compile | Работает при включённом `extract_spec_points` и AI-ключе. |
| CRM/Bitrix export modules | `app/api/crm.py` | 55% | Python compile | В реализации: есть API/сервисы, нужна реальная интеграционная проверка с Bitrix. |
| Competitor tailoring detection | `app/api/tailoring.py` | 60% | Python compile | В реализации: есть модели/сервис, нужна проверка на реальных ТС и маркерах. |
| Commercial proposals | `app/api/commercial_proposals.py` | 55% | Python compile | В реализации: нужен реальный шаблон/хранилище/проверка DOCX. |
| CitizenSec L1 assistant | `app/api/citizensec.py` | 55% | Python compile | В реализации: зависит от внешних анализаторов/ключей. |
| Decision knowledge RAG | `app/api/knowledge.py` | 60% | Python compile | В реализации: есть эндпоинты/хранилище, требуется UX-интеграция. |

## Проверка фильтров “во всех местах”

| Страница | Поля поиска/фильтра | Состояние |
|---|---|---|
| `/tenders` | название, заказчик/организатор, вид закупки через backend keywords; сумма и вкладки локально | Исправлено |
| `/bids` | название, организатор, вид закупки, статус, ID | Исправлено |
| `/analytics/historical` | название, заказчик, организатор, описание, вид закупки, регион, победитель, даты, суммы, участие | Исправлено |
| `/analytics/customers` | кандидаты по заказчику; история по кандидатам и отслеживаемым | Исправлено |
| `/analytics/winners` | победитель, победы, суммы | Добавлено |
| `/analytics/prices` | название, заказчик, вид закупки, победитель, суммы, скидка | Добавлено |
| `/notifications` | заголовок, сообщение, тип, категория | Добавлено |
| `/dictionaries` | значение, последний лот, активность | Добавлено |
| `/companies` | компания, ИНН, город, verified | Добавлено |
| `/users` | имя, email, роль, компания, статус | Добавлено |

## Известные баги и ограничения

1. Полный `go test ./...` может падать на старых тестах `internal/tenderplus` из-за несовпадения структуры `LotBuy.Documents`; это не связано с текущими фильтрами.
2. `/tenders` зависит от того, как TenderPlus интерпретирует `keywords`; если внешний API не ищет по компании, локально невозможно найти то, что не пришло в ответе.
3. `/tenders` вкладки и сумма фильтруют текущую страницу, а не весь внешний каталог TenderPlus.
4. `companies`, `users`, `settings` пока демо/UI без полноценного backend CRUD.
5. Уведомления и справочники хранятся в localStorage, поэтому не синхронизируются между пользователями.
6. RAG AI-анализ требует ключ в `.env`; без него endpoints корректно возвращают 503.
7. В `main.py` остались две косметические строки ошибок `Gemini (spec summary)`; они не влияют на работу Groq, но текст можно переименовать позже.
8. Документы-сканы без текстового слоя не индексируются, потому что OCR не реализован.

## Будущие фичи в реализации

| Фича | Текущий уровень | Следующий шаг |
|---|---:|---|
| Backend CRUD для пользователей | 20% | Подключить `Users` service в `cmd/api/main.go`, добавить auth/roles UI. |
| Backend CRUD для компаний | 20% | Добавить модели, endpoints, заменить demo-массив на API. |
| Серверные уведомления | 25% | Таблица notifications + API + websocket/SSE или polling. |
| Серверные справочники парсера | 35% | Перенести localStorage в backend и подключить к TenderPlus sync/search. |
| Экспорт с текущими фильтрами | 45% | Передавать фильтры UI в `/analytics/export`. |
| Улучшенный поиск TenderPlus | 50% | Разделить `keywords` и локальный post-filter, добавить расширенный поиск по нескольким страницам. |
| OCR для PDF-сканов | 10% | Добавить OCR pipeline и лимиты размера/страниц. |
| Bitrix24 CRM export | 55% | Подключить реальные credentials и e2e-тест экспорта. |
| Tailoring detection | 60% | Накопить маркеры конкурентов и вывести результаты в UI тендера. |
| Commercial proposal generation | 55% | Настроить шаблоны DOCX, проверить скачивание/хранилище. |
| CitizenSec assistant | 55% | Подключить внешние threat intel ключи и UI. |
| Decision memory RAG | 60% | Интегрировать подсказки прошлых решений в карточку тендера. |

## Рекомендуемая настройка Groq в `.env`

Не хранить ключ в исходниках. В `tender-rag/.env` добавить:

```env
AI_PROVIDER=groq
GROQ_API_KEY=<ваш Groq API key>
GROQ_BASE_URL=https://api.groq.com/openai/v1
CHAT_MODEL=llama-3.1-8b-instant
```

После изменения `.env` нужно перезапустить `tender-rag`.
