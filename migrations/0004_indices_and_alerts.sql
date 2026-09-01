-- FR-022 spectral indices, FR-060 notifications, and the scheduled self-check
-- that keeps both honest.

-- Indices are cached exactly like embeddings: same point/year, same answer.
CREATE TABLE indices_cache (
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  year INTEGER NOT NULL,
  ndvi REAL,
  ndre REAL,
  ndmi REAL,
  nbr REAL,
  source TEXT NOT NULL DEFAULT 'earth_engine',
  fetched_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_indices_cache_point ON indices_cache(lat, lng, year);

ALTER TABLE mesh_cells ADD COLUMN ndvi REAL;
ALTER TABLE mesh_cells ADD COLUMN ndre REAL;
ALTER TABLE mesh_cells ADD COLUMN ndmi REAL;
ALTER TABLE mesh_cells ADD COLUMN nbr REAL;
ALTER TABLE meshes ADD COLUMN with_indices INTEGER NOT NULL DEFAULT 0;

-- FR-060. An alert names what happened AND what the reader should do, because
-- an alert that only states an event gets ignored.
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  severity TEXT NOT NULL,          -- high | medium | low
  category TEXT NOT NULL,          -- threshold | review | data | system
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  next_action TEXT,
  lat REAL,
  lng REAL,
  link TEXT,
  source_id TEXT,                  -- the row that raised it; dedupes repeats
  read_at TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_alerts_unread ON alerts(read_at, created_at);
CREATE UNIQUE INDEX idx_alerts_source ON alerts(category, source_id);

-- Configurable thresholds, so a customer can tune sensitivity without a deploy.
CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  metric TEXT NOT NULL,            -- change_score | ndvi_drop | similarity
  comparator TEXT NOT NULL,        -- gte | lte
  threshold REAL NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

INSERT INTO alert_rules (id, name, metric, comparator, threshold, severity, enabled, created_at) VALUES
  ('rule_change_high', '前年比の変化が大きい区域', 'change_score', 'gte', 0.15, 'high', 1, datetime('now')),
  ('rule_ndvi_drop', '植生指数の低下', 'ndvi_drop', 'gte', 0.15, 'medium', 1, datetime('now')),
  ('rule_similarity_high', '保全優先水準の区域を検出', 'similarity', 'gte', 0.85, 'low', 1, datetime('now'));

-- Results of the scheduled self-check. The build sandbox cannot reach
-- earthengine.googleapis.com, so the deployed Worker verifies its own Earth
-- Engine expression graphs on a schedule and records the raw upstream error
-- here, where it can be read without a person having to open a URL.
CREATE TABLE system_checks (
  id TEXT PRIMARY KEY,
  check_name TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT,
  detail TEXT,
  duration_ms INTEGER,
  checked_at TEXT NOT NULL
);

CREATE INDEX idx_system_checks_name ON system_checks(check_name, checked_at);
