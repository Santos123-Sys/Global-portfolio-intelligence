# Deployment order

Apply database migration `0026_canonical_research_orchestrator.sql` before serving application code that writes `analysis_session_id`. The migration is additive and preserves all historical legacy run data.
