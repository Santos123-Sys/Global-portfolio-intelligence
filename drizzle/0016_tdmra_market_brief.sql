ALTER TABLE "discovery_candidates"
	ADD COLUMN "external_market_brief_id" text,
	ADD COLUMN "market_brief_status" text DEFAULT 'not_started' NOT NULL,
	ADD COLUMN "market_brief_request_json" jsonb,
	ADD COLUMN "market_brief_json" jsonb,
	ADD COLUMN "market_brief_error_message" text;
