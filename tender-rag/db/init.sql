-- pgvector + chunks tied to lot_id (from your lots microservice or local ingest)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tender_chunks (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  source_hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lot_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS tender_chunks_lot_id_idx ON tender_chunks (lot_id);

-- Approximate NN index (ok to create on empty table in pgvector 0.5+)
CREATE INDEX IF NOT EXISTS tender_chunks_embedding_hnsw
  ON tender_chunks USING hnsw (embedding vector_cosine_ops);

-- Краткая выжимка ТЗ по лоту (из OpenAI после индексации)
CREATE TABLE IF NOT EXISTS lot_spec_summaries (
  lot_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lot_spec_summaries_updated_at_idx
  ON lot_spec_summaries (updated_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  title TEXT,
  description TEXT,
  amount NUMERIC(18,2),
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  source VARCHAR(64),
  source_url TEXT,
  deadline TIMESTAMPTZ,
  final_ai_reasoning TEXT,
  bitrix_deal_id VARCHAR(64),
  crm_status VARCHAR(128),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lots_external_id_idx ON lots (external_id);
CREATE INDEX IF NOT EXISTS lots_status_idx ON lots (status);
CREATE INDEX IF NOT EXISTS lots_bitrix_deal_id_idx ON lots (bitrix_deal_id);

CREATE TABLE IF NOT EXISTS lot_events (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  message TEXT,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lot_events_lot_id_idx ON lot_events (lot_id);
CREATE INDEX IF NOT EXISTS lot_events_event_type_idx ON lot_events (event_type);
CREATE INDEX IF NOT EXISTS lot_events_created_at_idx ON lot_events (created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at);

CREATE TABLE IF NOT EXISTS lot_items (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  item_number VARCHAR(64),
  paragraph_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(384),
  source_hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lot_id, paragraph_index)
);

CREATE INDEX IF NOT EXISTS lot_items_lot_id_idx ON lot_items (lot_id);
CREATE INDEX IF NOT EXISTS lot_items_embedding_hnsw
  ON lot_items USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS competitor_markers (
  id BIGSERIAL PRIMARY KEY,
  product_name TEXT NOT NULL,
  competitor_name TEXT,
  marker_type VARCHAR(80) NOT NULL DEFAULT 'feature',
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  severity DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  source_url TEXT,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS competitor_markers_product_name_idx ON competitor_markers (product_name);
CREATE INDEX IF NOT EXISTS competitor_markers_embedding_hnsw
  ON competitor_markers USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS spec_suspicions (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  lot_item_id BIGINT REFERENCES lot_items(id) ON DELETE SET NULL,
  marker_id BIGINT REFERENCES competitor_markers(id) ON DELETE SET NULL,
  paragraph_index INT NOT NULL,
  paragraph_text TEXT NOT NULL,
  product_name TEXT,
  similarity DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION,
  risk_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  verdict TEXT NOT NULL,
  explanation TEXT NOT NULL,
  development_cost_estimate JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spec_suspicions_lot_id_idx ON spec_suspicions (lot_id);
CREATE INDEX IF NOT EXISTS spec_suspicions_created_at_idx ON spec_suspicions (created_at);

CREATE TABLE IF NOT EXISTS client_profiles (
  id BIGSERIAL PRIMARY KEY,
  bin VARCHAR(32) UNIQUE,
  company_name TEXT,
  domain TEXT,
  employees_count INT,
  contacts JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_profiles_bin_idx ON client_profiles (bin);

CREATE TABLE IF NOT EXISTS commercial_proposals (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  client_profile_id BIGINT REFERENCES client_profiles(id) ON DELETE SET NULL,
  proposal_number VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  service_package VARCHAR(80) NOT NULL,
  discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'KZT',
  price_payload JSONB NOT NULL,
  vat_included BOOLEAN NOT NULL DEFAULT TRUE,
  total_amount NUMERIC(18,2) NOT NULL,
  storage_backend VARCHAR(32) NOT NULL,
  storage_bucket TEXT,
  storage_key TEXT NOT NULL,
  file_url TEXT,
  template_name TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_number, version)
);

CREATE INDEX IF NOT EXISTS commercial_proposals_lot_id_idx ON commercial_proposals (lot_id);
CREATE INDEX IF NOT EXISTS commercial_proposals_proposal_number_idx ON commercial_proposals (proposal_number);
CREATE INDEX IF NOT EXISTS commercial_proposals_created_at_idx ON commercial_proposals (created_at);


CREATE TABLE IF NOT EXISTS lot_decision_knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  decision VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  payload JSONB,
  updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lot_decision_knowledge_chunks_lot_id_idx ON lot_decision_knowledge_chunks (lot_id);
CREATE INDEX IF NOT EXISTS lot_decision_knowledge_chunks_decision_idx ON lot_decision_knowledge_chunks (decision);
CREATE INDEX IF NOT EXISTS lot_decision_knowledge_chunks_embedding_hnsw
  ON lot_decision_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS citizensec_incidents (
  id BIGSERIAL PRIMARY KEY,
  lot_id TEXT REFERENCES lots(id) ON DELETE SET NULL,
  submitted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  input_type VARCHAR(16) NOT NULL,
  original_url TEXT,
  original_filename TEXT,
  storage_key TEXT,
  virustotal_analysis_id TEXT,
  virustotal_report JSONB,
  threat_label VARCHAR(80),
  severity VARCHAR(32),
  summary TEXT,
  social_post_draft TEXT,
  kb_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS citizensec_incidents_lot_id_idx ON citizensec_incidents (lot_id);
CREATE INDEX IF NOT EXISTS citizensec_incidents_threat_label_idx ON citizensec_incidents (threat_label);
CREATE INDEX IF NOT EXISTS citizensec_incidents_created_at_idx ON citizensec_incidents (created_at);

CREATE TABLE IF NOT EXISTS citizensec_knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  source_id TEXT,
  title TEXT,
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS citizensec_knowledge_chunks_embedding_hnsw
  ON citizensec_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
