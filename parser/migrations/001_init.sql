CREATE TABLE IF NOT EXISTS parser_keywords (
    id SERIAL PRIMARY KEY,
    value VARCHAR(255) UNIQUE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parser_lots (
    id SERIAL PRIMARY KEY,
    stable_id VARCHAR(255) UNIQUE NOT NULL,
    source VARCHAR(64) NOT NULL,
    external_id VARCHAR(128) NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount NUMERIC(18, 2),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    place TEXT,
    customer_name TEXT,
    organizer_name TEXT,
    purchase_type VARCHAR(255),
    status VARCHAR(64) NOT NULL DEFAULT 'active',
    complaints_count INTEGER,
    winner_bin VARCHAR(32),
    winner_name TEXT,
    fingerprint VARCHAR(64) NOT NULL,
    documents_fingerprint VARCHAR(64),
    raw JSONB,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT parser_lots_source_external_id_key UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS parser_documents (
    id SERIAL PRIMARY KEY,
    lot_stable_id VARCHAR(255) NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    kind VARCHAR(64) NOT NULL DEFAULT 'document',
    content_type VARCHAR(255),
    sha256 VARCHAR(64),
    local_path TEXT,
    text_chars INTEGER,
    rag_indexed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT parser_documents_lot_url_key UNIQUE (lot_stable_id, url)
);

CREATE TABLE IF NOT EXISTS parser_notifications (
    id SERIAL PRIMARY KEY,
    lot_stable_id VARCHAR(255),
    type VARCHAR(32) NOT NULL DEFAULT 'info',
    category VARCHAR(64) NOT NULL DEFAULT 'updates',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    payload JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parser_runs (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    platforms JSONB,
    keywords JSONB,
    lots_found INTEGER NOT NULL DEFAULT 0,
    lots_changed INTEGER NOT NULL DEFAULT 0,
    errors JSONB
);

CREATE INDEX IF NOT EXISTS idx_parser_lots_source ON parser_lots(source);
CREATE INDEX IF NOT EXISTS idx_parser_lots_external_id ON parser_lots(external_id);
CREATE INDEX IF NOT EXISTS idx_parser_lots_end_date ON parser_lots(end_date);
CREATE INDEX IF NOT EXISTS idx_parser_lots_winner_bin ON parser_lots(winner_bin);
CREATE INDEX IF NOT EXISTS idx_parser_documents_lot ON parser_documents(lot_stable_id);
CREATE INDEX IF NOT EXISTS idx_parser_documents_sha ON parser_documents(sha256);
CREATE INDEX IF NOT EXISTS idx_parser_notifications_lot ON parser_notifications(lot_stable_id);
