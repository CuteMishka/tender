# Integrations and AI Modules

## File structure

```text
app/
  api/
    crm.py
    tailoring.py
    commercial_proposals.py
    citizensec.py
  services/
    audit_service.py
    bitrix_service.py
    citizensec_service.py
    commercial_proposal_service.py
    gemini_service.py
    lot_service.py
    storage_service.py
    tailoring_detection_service.py
  database.py
  models.py
```

## Database layer

The service keeps the existing `psycopg` RAG path for `tender_chunks` and adds an async SQLAlchemy layer for integration modules.

Core tables:

- `lots` stores canonical lot metadata and CRM status.
- `lot_events` stores audit events, user comments and AI final reasoning references.
- `notifications` is reserved for manager-facing alerts.
- `lot_items` stores normalized specification paragraphs with pgvector embeddings.
- `competitor_markers` stores known competitor-specific markers.
- `spec_suspicions` stores highlighted suspicious specification paragraphs.
- `client_profiles` stores BIN, domain, employees count and contacts.
- `commercial_proposals` stores proposal number, version, pricing metadata and object storage key.
- `citizensec_incidents` stores VirusTotal reports and Gemini summaries.
- `citizensec_knowledge_chunks` is prepared for CitizenSec L1 RAG content.

`lot_service.get_or_import_lot()` first reads `lots`. If the lot is absent and `saved_lots` contains the same numeric id, it imports the Go-side saved lot into `lots`.

## Bitrix24 CRM export

Endpoints:

- `POST /v1/lots/{lot_id}/crm/export`
- `POST /v1/crm/bitrix/webhook?secret=...`

Flow:

1. `BitrixService.export_lot_to_crm()` loads the lot and verifies status `participating` / `uchastvuem`.
2. It collects audit records from `lot_events` with user comments and final AI reasoning event types.
3. It creates a Bitrix24 deal via REST method `crm.deal.add`.
4. It posts comments to the CRM timeline via `crm.timeline.comment.add`.
5. It stores `bitrix_deal_id`, `crm_status` and writes audit events back to `lot_events`.
6. The webhook handler syncs closed CRM stages into Tender Machine statuses `won` or `lost`.

Required environment:

```text
BITRIX24_WEBHOOK_URL=https://your-domain.bitrix24.kz/rest/1/webhook-token
BITRIX24_WEBHOOK_SECRET=change-me
BITRIX24_CURRENCY=KZT
```

## Tailoring / competitor lock-in detection

Endpoints:

- `POST /v1/competitor-markers`
- `POST /v1/lots/{lot_id}/items/index`
- `POST /v1/lots/{lot_id}/tailoring/analyze`
- `GET /v1/lots/{lot_id}/tailoring`

RAG flow:

1. Add known competitor markers into `competitor_markers`; each marker is embedded with the same multilingual model as tender chunks.
2. Split the technical specification into paragraphs and store them in `lot_items`.
3. For each paragraph, query nearest `competitor_markers` by cosine distance.
4. Candidate pairs above `min_similarity` are sent to Gemini.
5. Gemini returns structured JSON with `is_suspicious`, confidence, risk level, explanation and development cost estimate.
6. UI can highlight rows from `spec_suspicions` by `paragraph_index` and show `verdict` / `explanation`.

Gemini prompt is implemented in `TAILORING_SYSTEM_PROMPT` and requires a JSON response. A typical verdict is: `Пункт 4.2 ТС на 90% совпадает с уникальным функционалом продукта X`.

## Commercial proposal generator

Endpoint:

- `POST /v1/lots/{lot_id}/commercial-proposals`

Flow:

1. Collect client data: BIN, company name, domain, employees count and contacts.
2. Upsert `client_profiles`.
3. Calculate price from package, employees count, margin, VAT and discount.
4. Generate a stable proposal number per lot and increment version for every new revision.
5. Render DOCX via `docxtpl` from `CP_TEMPLATE_DIR`.
6. Store file in local storage, MinIO or S3 through `ObjectStorageService`.
7. Write metadata to `commercial_proposals` and audit to `lot_events`.

Request example:

```json
{
  "service_package": "citizensec_standard",
  "discount_percent": 10,
  "client": {
    "bin": "123456789012",
    "company_name": "Example LLP",
    "domain": "example.kz",
    "employees_count": 250,
    "contacts": {"manager": "+7..."}
  },
  "parameters": {"template_name": "commercial_proposal.docx"}
}
```

## CitizenSec L1 assistant

Endpoints:

- `POST /v1/citizensec/incidents/url`
- `POST /v1/citizensec/incidents/file`

Flow:

1. Accept URL or file from web UI / Telegram bot.
2. Submit the object to VirusTotal API and poll the analysis report.
3. Store incident metadata and raw VirusTotal report.
4. Send compact report to Gemini with L1 analyst prompt.
5. Store threat label, severity, summary, recommended knowledge-base payload and social post draft.
6. If `lot_id` is supplied, write an audit event to `lot_events`.

Required environment:

```text
VIRUSTOTAL_API_KEY=...
GEMINI_API_KEY=...
```


## Decision RAG memory

Endpoints:

- `PUT /v1/lots/{lot_id}/decision-reason`
- `POST /v1/knowledge/decision-reasons/search`

Flow:

1. When a manager updates the reason for not participating, `replace_lot_decision_reason()` deletes the previous vector row for the lot.
2. It embeds the new reason and stores it in `lot_decision_knowledge_chunks`.
3. It updates lot status and writes `decision_reason_reindexed` to `lot_events`.
4. Future lot analysis can search similar historical decisions by semantic query.

## Object storage

Supported modes:

- `STORAGE_BACKEND=local`
- `STORAGE_BACKEND=s3`
- `STORAGE_BACKEND=minio`

For MinIO/S3 configure `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_REGION` and optional `S3_PUBLIC_BASE_URL`.
