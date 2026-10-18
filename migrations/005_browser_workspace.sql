CREATE TABLE IF NOT EXISTS gpi_browser_sessions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, idempotency_key uuid NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS gpi_browser_commands (
 session_id uuid NOT NULL REFERENCES gpi_browser_sessions(id) ON DELETE CASCADE,
 id uuid NOT NULL, actor_id uuid NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS gpi_browser_events (
 session_id uuid NOT NULL REFERENCES gpi_browser_sessions(id) ON DELETE CASCADE,
 seq integer NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(session_id,seq)
);
CREATE TABLE IF NOT EXISTS gpi_browser_observations (
 session_id uuid NOT NULL REFERENCES gpi_browser_sessions(id) ON DELETE CASCADE,
 id uuid NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(session_id,id)
);
