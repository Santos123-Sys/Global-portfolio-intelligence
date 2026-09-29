CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "company_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "security_id" uuid NOT NULL REFERENCES "securities"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ticker" text NOT NULL, "exchange" text NOT NULL, "country" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_ingested_at" timestamp with time zone,
  "document_count" integer DEFAULT 0 NOT NULL,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "rag_enabled" boolean DEFAULT false NOT NULL
);
CREATE UNIQUE INDEX "cw_security_owner_idx" ON "company_workspaces" ("security_id", "owner_id");
CREATE INDEX "cw_owner_idx" ON "company_workspaces" ("owner_id");

CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "company_workspaces"("id") ON DELETE CASCADE,
  "security_id" uuid NOT NULL REFERENCES "securities"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "folder_type" text NOT NULL, "document_type" text NOT NULL, "source" text NOT NULL,
  "title" text NOT NULL, "description" text, "url" text, "local_path" text,
  "content_hash" text, "external_id" text,
  "published_date" timestamp with time zone, "fiscal_year_end" date, "fiscal_period" text,
  "retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone, "content_text" text, "content_length" integer,
  "processing_status" text DEFAULT 'pending' NOT NULL, "processing_error" text,
  "retry_count" integer DEFAULT 0 NOT NULL, "language" text DEFAULT 'en',
  "page_count" integer, "file_format" text, "is_primary_source" boolean DEFAULT true NOT NULL,
  "is_amendment" boolean DEFAULT false, "amended_document_id" uuid,
  "superseded_at" timestamp with time zone, "metadata_json" jsonb,
  CONSTRAINT "documents_amended_document_id_documents_id_fk" FOREIGN KEY ("amended_document_id") REFERENCES "documents"("id")
);
CREATE INDEX "documents_workspace_idx" ON "documents" ("workspace_id");
CREATE INDEX "documents_security_idx" ON "documents" ("security_id");
CREATE INDEX "documents_owner_idx" ON "documents" ("owner_id");
CREATE INDEX "documents_type_idx" ON "documents" ("folder_type", "document_type");
CREATE INDEX "documents_status_idx" ON "documents" ("processing_status");
CREATE INDEX "documents_external_id_idx" ON "documents" ("external_id");
CREATE INDEX "documents_content_hash_idx" ON "documents" ("content_hash");
CREATE INDEX "documents_published_date_idx" ON "documents" ("published_date");

CREATE TABLE "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "company_workspaces"("id") ON DELETE CASCADE,
  "security_id" uuid NOT NULL REFERENCES "securities"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL, "chunk_text" text NOT NULL, "chunk_length" integer NOT NULL,
  "context_before" text, "context_after" text, "section_title" text, "section_type" text,
  "chunk_hash" text NOT NULL, "embedding_status" text DEFAULT 'pending' NOT NULL,
  "embedded_at" timestamp with time zone
);
CREATE INDEX "chunks_document_idx" ON "document_chunks" ("document_id");
CREATE INDEX "chunks_workspace_idx" ON "document_chunks" ("workspace_id");
CREATE INDEX "chunks_security_idx" ON "document_chunks" ("security_id");
CREATE INDEX "chunks_owner_idx" ON "document_chunks" ("owner_id");
CREATE INDEX "chunks_embedding_status_idx" ON "document_chunks" ("embedding_status");

CREATE TABLE "document_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chunk_id" uuid NOT NULL REFERENCES "document_chunks"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "company_workspaces"("id") ON DELETE CASCADE,
  "security_id" uuid NOT NULL REFERENCES "securities"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "embedding" vector(768) NOT NULL,
  "embedding_model" text DEFAULT 'text-embedding-004' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "emb_document_idx" ON "document_embeddings" ("document_id");
CREATE INDEX "emb_workspace_idx" ON "document_embeddings" ("workspace_id");
CREATE INDEX "emb_security_idx" ON "document_embeddings" ("security_id");
CREATE INDEX "emb_owner_idx" ON "document_embeddings" ("owner_id");
CREATE INDEX "document_embeddings_hnsw_idx" ON "document_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16, ef_construction=64);

CREATE TABLE "ingestion_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "company_workspaces"("id") ON DELETE CASCADE,
  "security_id" uuid NOT NULL REFERENCES "securities"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "job_type" text NOT NULL, "status" text DEFAULT 'queued' NOT NULL,
  "started_at" timestamp with time zone, "completed_at" timestamp with time zone,
  "documents_discovered" integer DEFAULT 0, "documents_ingested" integer DEFAULT 0,
  "chunks_created" integer DEFAULT 0, "chunks_embedded" integer DEFAULT 0,
  "error_message" text, "log_json" jsonb, "triggered_by" text DEFAULT 'schedule'
);
CREATE INDEX "ij_workspace_idx" ON "ingestion_jobs" ("workspace_id");
CREATE INDEX "ij_status_idx" ON "ingestion_jobs" ("status");
CREATE INDEX "ij_type_idx" ON "ingestion_jobs" ("job_type", "status");

CREATE TABLE "rag_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "company_workspaces"("id") ON DELETE CASCADE,
  "security_id" uuid NOT NULL REFERENCES "securities"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text DEFAULT 'New Conversation',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "rag_conv_workspace_idx" ON "rag_conversations" ("workspace_id");
CREATE INDEX "rag_conv_user_idx" ON "rag_conversations" ("user_id");

CREATE TABLE "rag_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "rag_conversations"("id") ON DELETE CASCADE,
  "role" text NOT NULL, "content" text NOT NULL, "citations_json" jsonb,
  "retrieved_chunks_json" jsonb, "prompt_tokens" integer, "completion_tokens" integer,
  "model" text DEFAULT 'gemini-1.5-flash',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "rag_msg_conversation_idx" ON "rag_messages" ("conversation_id");

-- Existing holdings receive the same workspace that newly-created positions
-- receive in the application transaction. DISTINCT handles securities held in
-- more than one portfolio owned by the same account.
INSERT INTO "company_workspaces" ("security_id", "owner_id", "ticker", "exchange", "country")
SELECT DISTINCT s."id", p."owner_id", s."ticker", s."exchange", s."country"
FROM "positions" pos
JOIN "portfolios" p ON p."id" = pos."portfolio_id"
JOIN "securities" s ON s."id" = pos."security_id"
ON CONFLICT ("security_id", "owner_id") DO NOTHING;

INSERT INTO "ingestion_jobs" ("workspace_id", "security_id", "owner_id", "job_type", "triggered_by", "log_json")
SELECT cw."id", cw."security_id", cw."owner_id", 'full_ingestion', 'migration_backfill', '["Initial ingestion queued by migration_backfill"]'::jsonb
FROM "company_workspaces" cw
ON CONFLICT DO NOTHING;
