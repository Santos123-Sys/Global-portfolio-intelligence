# Orchestration migration rollback

The migration is intentionally non-destructive. `external_analysis_run_id`, legacy run rows, imported analyses and existing report artifacts are retained. If the canonical candidate handoff must be disabled before merge/deployment, reverting PR #134 restores the old write path without requiring data restoration.

After deployment, already-created canonical `agent_analysis_sessions` remain auditable even if application code is rolled back. The migration adds only `discovery_candidates.analysis_session_id` and an index; no legacy columns or tables are dropped.
