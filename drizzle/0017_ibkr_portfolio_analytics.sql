CREATE TABLE "broker_account_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_masked" text NOT NULL,
	"base_currency" text NOT NULL,
	"cash" numeric(24, 8) NOT NULL,
	"net_liquidation" numeric(24, 8) NOT NULL,
	"available_funds" numeric(24, 8) NOT NULL,
	"buying_power" numeric(24, 8) NOT NULL,
	"information_gaps" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"con_id" text NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"currency" text NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"avg_cost" numeric(24, 8) NOT NULL,
	"last_price" numeric(24, 8) NOT NULL,
	"cost_basis" numeric(24, 8) NOT NULL,
	"market_value" numeric(24, 8) NOT NULL,
	"unrealized_pnl" numeric(24, 8) NOT NULL,
	"return_pct" real,
	"first_detected_fill" text,
	"days_since_detected_fill" integer,
	"annualized_return_pct" real
);
--> statement-breakpoint
CREATE TABLE "broker_order_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"provider" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_account_snapshots" ADD CONSTRAINT "broker_account_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broker_position_snapshots" ADD CONSTRAINT "broker_position_snapshots_snapshot_id_broker_account_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."broker_account_snapshots"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broker_order_previews" ADD CONSTRAINT "broker_order_previews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broker_order_previews" ADD CONSTRAINT "broker_order_previews_snapshot_id_broker_account_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."broker_account_snapshots"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "broker_snapshot_owner_captured_idx" ON "broker_account_snapshots" USING btree ("owner_id","captured_at");
--> statement-breakpoint
CREATE INDEX "broker_position_snapshot_value_idx" ON "broker_position_snapshots" USING btree ("snapshot_id","market_value");
--> statement-breakpoint
CREATE INDEX "broker_preview_owner_created_idx" ON "broker_order_previews" USING btree ("owner_id","created_at");
