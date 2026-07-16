# Backend security and route policy

The API is deny-by-default. Apart from `/health`, login, registration, and CORS
preflight, every route requires either a valid server-side session or an
explicitly allowlisted internal-service capability. Adding a new route also
requires adding an entry to `internal/api/auth_middleware.go`; otherwise it
returns `403` even to an administrator.

## Production environment

Set these explicitly in production:

- `CORS_ALLOWED_ORIGINS`: comma-separated browser origins, including scheme and
  port when non-default. When this is set, development localhost origins are not
  retained.
- `AUTH_ALLOWED_ORIGINS`: origins allowed to submit browser writes. Usually the
  same values as `CORS_ALLOWED_ORIGINS`. Wildcards are rejected.
- `AUTH_ALLOWED_HOSTS`: comma-separated API Host values without a scheme, for
  example `tender.example.kz,api.tender.example.kz`. A leading dot allows only
  subdomains. All requests, including safe `GET` requests, are Host-validated.
- `AUTH_COOKIE_SECURE=true`: required behind HTTPS. Set `false` only for local
  HTTP development.
- `AUTH_COOKIE_SAMESITE=strict`: `strict`, `lax`, or `none`; `none` requires
  Secure cookies. Prefer `strict` when the UI and API are same-site.
- `AUTH_COOKIE_NAME` and `AUTH_CSRF_COOKIE_NAME`: default to `tender_session`
  and `tender_csrf`. A production deployment may use `__Host-` names when it is
  always HTTPS.
- `AUTH_SESSION_TTL`: fixed session lifetime, default `12h`.
- `AUTH_SESSION_TOUCH_INTERVAL`: last-seen write interval, default `5m`.
- `AUTH_LOGIN_ACCOUNT_RATE_LIMIT`: attempts per normalized account per window,
  default `5`.
- `AUTH_LOGIN_IP_RATE_LIMIT`: attempts per client IP per window, default `60`.
- `AUTH_LOGIN_RATE_WINDOW`: default `15m`.
- `AUTH_REGISTER_RATE_LIMIT`: requests per client IP, default `3`.
- `AUTH_REGISTER_RATE_WINDOW`: default `1h`.
- `AUTH_TRUSTED_PROXY_CIDRS`: immediate reverse-proxy networks. Narrow this to
  the actual Nginx/Docker network. Only a peer in this list may supply
  `X-Real-IP`; `X-Forwarded-For` is never trusted for rate-limit identity.
- `BACKEND_INTERNAL_SERVICE_TOKEN`: a random secret of at least 32 characters,
  accepted only by the Go API's narrow automation allowlist and used by the
  parser/SSH enqueue client.
- `RAG_INTERNAL_SERVICE_TOKEN`: a different random secret of at least 32
  characters, accepted only by FastAPI and used by the Go API/parser for RAG
  calls. Both use the on-wire header `X-Internal-Service-Token`, but the values
  must be distinct. Legacy `INTERNAL_SERVICE_TOKEN` is rejected rather than
  used as a shared fallback.
- `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD`: used only to bootstrap an admin
  when no administrator exists. Keep at least one active administrator.

The deprecated `AUTH_LOGIN_RATE_LIMIT` is not used. Configure both account and
IP limits above.

Terminate TLS at the reverse proxy, expose only ports 80/443, and keep the API,
PostgreSQL, parser, and RAG ports on an internal network or loopback. Nginx must
overwrite (not append or pass through) `X-Real-IP`. Keep a tested SSH public-key
break-glass path; do not create application backdoors or expose the internal
service token to a browser.

## Session and CSRF contract

`POST /api/v1/auth/login` accepts `{"email":"...","password":"..."}` and
returns the user object. It sets:

- an opaque, 256-bit `HttpOnly` session cookie; only its SHA-256 hash is stored;
- a separate readable CSRF cookie whose SHA-256 hash is bound to that session.

The browser must use `credentials: "include"`. For every `POST`, `PUT`, `PATCH`,
or `DELETE` authenticated by a cookie, it must copy the CSRF cookie value to
`X-CSRF-Token`. The API also validates Origin and Host. `GET /api/v1/auth/me`
returns the current user. `POST /api/v1/auth/logout` revokes the server session
and clears both cookies. `POST /api/v1/auth/logout-all` revokes every session
for the current user. Administrators can revoke every session for a user with
`POST /api/v1/users/{id}/sessions/revoke`; the response does not disclose
whether that user exists. Expired and revoked session rows are purged opportunistically.

Login failures are generic and perform a dummy bcrypt check for unknown
accounts. Login, registration, logout, `401`, `403`, and CSRF failures emit
single-line `security_audit` JSON logs with request ID, route, status, client IP,
and authenticated user ID/role when available. Passwords, cookies, CSRF values,
and raw tokens are never logged.

Registration always returns `202 {"success":true}` for both a new request and an
existing user/pending request. Requests are serialized by normalized email.
Registration password hashes are erased after approval or rejection, and
approval creates the user and updates the request in one transaction.

## Route policy

| Access | Routes |
|---|---|
| Public | `GET /health`; `POST /api/v1/auth/login`; `POST /api/v1/auth/register-request`; preflight `OPTIONS` |
| Any authenticated role | `GET /api/v1/auth/me`; `POST /api/v1/auth/logout`; `POST /api/v1/auth/logout-all`; tender list/detail, canonical auto spec-summary and chat; notifications; dictionary reads; parser status; document proxy; dashboard reads; saved-lot/activity/comment/task reads; analytics reads/export/report preview and DOCX; stateless RAG analysis and stored summary reads; `GET /api/v1/users`; own Telegram binding (admin may access any) |
| `tender_specialist`, `director`, or `admin` | Participate/remove saved or suitable lots; create comments/tasks; update tasks; analytics lot/customer workflow mutations |
| `director` or `admin` | List/approve/reject registration requests; update roles or delete non-admin users |
| `admin` only | Grant/change/delete an admin; revoke all sessions for any user; dictionary mutations; parser run/reanalysis; direct RAG text/document indexing; global Telegram settings; analytics sync |
| Backend internal service token | `GET /api/v1/parser/status`; `POST /api/v1/parser/run`; `POST /api/v1/parser/reanalyze-existing`; `GET /api/v1/dictionaries`; `PUT /api/v1/dictionaries/{id}`; `POST /api/v1/analytics/sync` |

Self-delete and self-role-change are rejected. User-management transactions
re-read the actor and target under database locks. Directors cannot grant,
change, or delete an administrator, and the final active administrator cannot
be demoted or deleted even under concurrent requests.

## Protected RAG bridge

Browser calls use authenticated API routes instead of public RAG access:

- `POST /api/v1/rag/lot/analyze`
- `GET /api/v1/rag/lots/{lotId}/spec-summary`
- `POST /api/v1/tenders/{tenderId}/spec-summary/auto` (canonical server-side
  retrieval and indexing)

Direct mutation proxies `POST /api/v1/rag/lots/{lotId}/index` and
`index-document` are administrator-only to prevent authenticated browser users
from poisoning the shared knowledge base. The proxy accepts only fixed upstream
paths, validates media types and lot IDs, applies request/response limits,
strips browser credentials, and adds `RAG_INTERNAL_SERVICE_TOKEN`. Parser RAG
calls use that token; parser dictionary/enqueue calls use the distinct backend
token.
