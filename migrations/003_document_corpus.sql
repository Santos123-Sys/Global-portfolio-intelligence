CREATE TABLE IF NOT EXISTS gpi_documents (
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id text NOT NULL, issuer_id text NOT NULL, fiscal_year integer NOT NULL,
 metadata jsonb NOT NULL, original bytea NOT NULL, text_content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id)
);
CREATE INDEX IF NOT EXISTS gpi_documents_scope ON gpi_documents(owner_id,issuer_id,fiscal_year);
CREATE TABLE IF NOT EXISTS gpi_corpus_handoffs (
 token_hash text PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 issuer_id text NOT NULL,start_year integer NOT NULL,end_year integer NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
