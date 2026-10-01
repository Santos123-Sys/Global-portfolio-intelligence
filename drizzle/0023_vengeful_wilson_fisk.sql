CREATE TABLE "agent_evaluation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"configuration_id" uuid NOT NULL,
	"candidate" jsonb NOT NULL,
	"baseline" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_evaluation_jobs" ADD CONSTRAINT "agent_evaluation_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation_jobs" ADD CONSTRAINT "agent_evaluation_jobs_configuration_id_agent_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."agent_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_evaluation_queue_idx" ON "agent_evaluation_jobs" USING btree ("status","updated_at");