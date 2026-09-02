-- Two gaps found on re-reading the v3.0 requirements.
--
-- 1. FR-022 was wired only as far as the self-check: the NDRE change shown to a
--    user was still simulated. Candidates now carry the measured Sentinel-2
--    values, and a flag saying whether they were measured or estimated, so the
--    screen can label them honestly.
--
-- 2. FR-007 / NFR-010 / UAT-08 require an analysis to be reproducible from its
--    ID: same snapshot, same answer. analysis_id existed on site_candidates but
--    nothing recorded what the run actually used.

ALTER TABLE site_candidates ADD COLUMN ndre_measured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_candidates ADD COLUMN ndvi REAL;
ALTER TABLE site_candidates ADD COLUMN ndre REAL;
ALTER TABLE site_candidates ADD COLUMN ndmi REAL;
ALTER TABLE site_candidates ADD COLUMN nbr REAL;

-- One row per analysis run. inputs_json holds exactly what the model asked for,
-- so re-running is replaying this row rather than hoping the conversation is
-- still in scroll-back.
CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  conversation_id TEXT REFERENCES conversations(id),
  run_by TEXT REFERENCES users(id),
  purpose TEXT,
  inputs_json TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  -- The snapshot: everything that could change the numbers between two runs.
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  earth_engine_year INTEGER,
  embedding_dataset TEXT,
  indices_dataset TEXT,
  earth_engine_available INTEGER NOT NULL DEFAULT 0,
  reference_points INTEGER NOT NULL DEFAULT 0,
  executed_at TEXT NOT NULL,
  -- Set when this run replayed an earlier one, so the chain stays visible.
  replay_of TEXT REFERENCES analyses(id)
);

CREATE INDEX idx_analyses_project ON analyses(project_id, executed_at DESC);
