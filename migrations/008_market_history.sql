CREATE TABLE IF NOT EXISTS gpi_market_history_jobs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 candidate_key text NOT NULL, issuer_id text NOT NULL, symbol text NOT NULL, as_of date NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
 error_code text, snapshot_id text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,candidate_key,issuer_id,as_of)
);
CREATE INDEX IF NOT EXISTS gpi_market_history_pending ON gpi_market_history_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS gpi_market_history_snapshots (
 id text NOT NULL, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 candidate_key text NOT NULL, issuer_id text NOT NULL, symbol text NOT NULL,
 source_hash text NOT NULL, payload jsonb NOT NULL, quality jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id),
 CHECK(jsonb_typeof(payload)='object'), CHECK(jsonb_typeof(quality)='object')
);
CREATE INDEX IF NOT EXISTS gpi_market_history_latest ON gpi_market_history_snapshots(owner_id,candidate_key,created_at DESC);
