-- Risk Studio is the calculation authority; GPI owns account-scoped received snapshots.
CREATE TABLE IF NOT EXISTS gpi_portfolio_feedback (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 workspace_id uuid NOT NULL REFERENCES accounts(id), request_hash text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gpi_portfolio_feedback_owner ON gpi_portfolio_feedback(owner_id,workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gpi_approved_valuations (
 id text NOT NULL, owner_id uuid NOT NULL REFERENCES users(id),
 workspace_id uuid NOT NULL REFERENCES accounts(id), candidate_key text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
ALTER TABLE gpi_corpus_handoffs ADD COLUMN IF NOT EXISTS integration_ticket text;
