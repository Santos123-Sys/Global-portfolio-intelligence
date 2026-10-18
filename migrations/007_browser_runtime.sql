CREATE TABLE IF NOT EXISTS gpi_browser_runtime (
 id text PRIMARY KEY CHECK(id='browser'),
 owner uuid NOT NULL,
 lease_until timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object')
);
ALTER TABLE gpi_browser_workers ADD COLUMN IF NOT EXISTS runtime_generation uuid;
