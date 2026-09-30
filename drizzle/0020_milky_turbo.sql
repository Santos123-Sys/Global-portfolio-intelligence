ALTER TABLE "agent_analysis_sessions" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "evidence_snapshot" jsonb;