CREATE TABLE "portfolio_weight_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"prices_csv" text NOT NULL,
	"price_hash" text NOT NULL,
	"source" text NOT NULL,
	"currency" text NOT NULL,
	"holdings_hash" text NOT NULL,
	"base_decision_id" uuid,
	"config_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"final_json" jsonb,
	"confirmed_by" uuid,
	"acknowledged_warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "portfolio_weight_runs" ADD CONSTRAINT "portfolio_weight_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_weight_runs" ADD CONSTRAINT "portfolio_weight_runs_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_weight_runs" ADD CONSTRAINT "portfolio_weight_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_weight_runs" ADD CONSTRAINT "portfolio_weight_runs_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weight_runs_portfolio_created_idx" ON "portfolio_weight_runs" USING btree ("portfolio_id","created_at");