CREATE TABLE IF NOT EXISTS gpi_browser_workers (
 id uuid PRIMARY KEY,
 ready_until timestamptz NOT NULL,
 busy boolean NOT NULL DEFAULT false
);
-- Repair the earlier double-encoded representation without discarding receipts.
UPDATE gpi_browser_sessions SET payload=(payload#>>'{}')::jsonb WHERE jsonb_typeof(payload)='string';
UPDATE gpi_browser_commands SET payload=(payload#>>'{}')::jsonb WHERE jsonb_typeof(payload)='string';
UPDATE gpi_browser_events SET payload=(payload#>>'{}')::jsonb WHERE jsonb_typeof(payload)='string';
UPDATE gpi_browser_observations SET payload=(payload#>>'{}')::jsonb WHERE jsonb_typeof(payload)='string';
