CREATE TABLE "agent_tool_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"tool_name" text NOT NULL,
	"configuration_hash" text,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD COLUMN "runtime_policy" jsonb;--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD COLUMN "rollout_state" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD COLUMN "evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "agent_analysis_sessions" ADD COLUMN "configuration_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "configuration_hash" text;--> statement-breakpoint
ALTER TABLE "agent_tool_traces" ADD CONSTRAINT "agent_tool_traces_session_id_agent_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tool_traces_session_idx" ON "agent_tool_traces" USING btree ("session_id");