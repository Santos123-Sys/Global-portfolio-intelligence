ALTER TABLE "discovery_candidates" ADD COLUMN "analysis_session_id" uuid;
CREATE INDEX "discovery_candidates_analysis_session_idx" ON "discovery_candidates" USING btree ("analysis_session_id");