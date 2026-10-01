CREATE TABLE "agent_session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"agent" text,
	"authority" text NOT NULL,
	"consequence" text NOT NULL,
	"reversible" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session_events" ADD CONSTRAINT "agent_session_events_session_id_agent_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_events_session_idx" ON "agent_session_events" USING btree ("session_id","occurred_at");