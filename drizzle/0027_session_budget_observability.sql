ALTER TABLE "agent_analysis_sessions" ADD COLUMN "budget_snapshot" jsonb;
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "model_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "unmetered_model_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "estimated_cost_usd" numeric(14, 6);
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "budget_active_ms" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "budget_started_at" timestamp with time zone;
