CREATE TABLE "portfolio_creator_sessions" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"state_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD COLUMN "investor_profile_json" jsonb;--> statement-breakpoint
ALTER TABLE "external_thesis_extractions" ADD COLUMN "investor_profile_json" jsonb;--> statement-breakpoint
ALTER TABLE "portfolio_creator_sessions" ADD CONSTRAINT "portfolio_creator_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;