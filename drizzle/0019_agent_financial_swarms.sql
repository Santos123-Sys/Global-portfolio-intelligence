
CREATE TABLE "agent_analysis_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"session_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text DEFAULT 'research' NOT NULL,
	"request_payload" jsonb NOT NULL,
	"final_output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"accuracy_score" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_belief_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"belief_category" text NOT NULL,
	"previous_belief" text,
	"updated_belief" text,
	"update_reason" text,
	"performance_delta" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_debates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"bull_argument" text NOT NULL,
	"bear_argument" text NOT NULL,
	"judge_reasoning" text NOT NULL,
	"final_score" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"security_id" uuid,
	"agent_name" text NOT NULL,
	"memory_type" text NOT NULL,
	"event_type" text NOT NULL,
	"event_content" jsonb NOT NULL,
	"relevance_score" numeric(5, 2),
	"decay_rate_hours" numeric(10, 2) DEFAULT '168',
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"agent_role" text NOT NULL,
	"input_payload" jsonb NOT NULL,
	"output_payload" jsonb,
	"reasoning_chain" text,
	"confidence_score" numeric(5, 2),
	"execution_time_ms" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_analysis_sessions" ADD CONSTRAINT "agent_analysis_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_analysis_sessions" ADD CONSTRAINT "agent_analysis_sessions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_belief_updates" ADD CONSTRAINT "agent_belief_updates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_debates" ADD CONSTRAINT "agent_debates_session_id_agent_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_events" ADD CONSTRAINT "agent_memory_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_events" ADD CONSTRAINT "agent_memory_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_agent_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_owner_security_idx" ON "agent_analysis_sessions" USING btree ("owner_id","security_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_queue_idx" ON "agent_analysis_sessions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "agent_memory_owner_idx" ON "agent_memory_events" USING btree ("owner_id","security_id");--> statement-breakpoint
CREATE INDEX "agent_runs_session_idx" ON "agent_runs" USING btree ("session_id");
