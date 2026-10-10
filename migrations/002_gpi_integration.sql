-- GPI-only milestone M1/M4. Additive tables; no cross-application database access.
-- Other applications remain authoritative for financial and portfolio data.
CREATE TABLE IF NOT EXISTS gpi_integration_reviews (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES accounts(id),
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  source_job_id uuid NOT NULL REFERENCES gpi_foundation_jobs(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('request_analysis', 'watchlist', 'reject')),
  review jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS gpi_integration_reviews_owner_created
  ON gpi_integration_reviews (owner_id, created_at DESC);

-- Durable and disabled-by-default event relay. Events are not delivered until
-- a separately verified, tenant-scoped consumer and credentials are available.
CREATE TABLE IF NOT EXISTS gpi_integration_outbox (
  event_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES accounts(id),
  review_id uuid NOT NULL REFERENCES gpi_integration_reviews(id),
  event jsonb NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS gpi_integration_outbox_pending
  ON gpi_integration_outbox (delivery_status, created_at);
