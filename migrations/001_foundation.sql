-- Additive only. Existing accounts and legacy business records are never dropped.
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, display_name text NOT NULL, password_hash text NOT NULL,
 password_changed_at timestamptz NOT NULL DEFAULT now(), role text NOT NULL DEFAULT 'member',
 mfa_secret_encrypted text, mfa_pending_secret_encrypted text, mfa_enabled_at timestamptz, mfa_recovery_code_hashes jsonb,
 mfa_last_used_step integer, created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE TABLE IF NOT EXISTS accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, account_type text NOT NULL DEFAULT 'personal',owner_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_user_idx ON accounts(owner_user_id);
CREATE TABLE IF NOT EXISTS memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),account_id uuid NOT NULL REFERENCES accounts(id),role text NOT NULL,invited_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_account_idx ON memberships(user_id,account_id);
CREATE TABLE IF NOT EXISTS user_sessions (id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),token_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_idx ON user_sessions(token_hash);
CREATE TABLE IF NOT EXISTS authentication_rate_limits (key_hash text PRIMARY KEY,kind text NOT NULL,failure_count integer NOT NULL DEFAULT 0,window_started_at timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS authentication_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES users(id),event_type text NOT NULL,outcome text NOT NULL,identity_hash text,ip_hash text,user_agent_hash text,metadata jsonb,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS gpi_foundation_workspaces (owner_id uuid PRIMARY KEY REFERENCES users(id),payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS gpi_foundation_jobs (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN ('screen','research')),
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,input jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
 output jsonb,error_code text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,
 lease_until timestamptz,lease_token uuid,UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS gpi_foundation_jobs_queue ON gpi_foundation_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS gpi_foundation_jobs_owner ON gpi_foundation_jobs(owner_id,created_at);
