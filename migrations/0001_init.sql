-- Geo Decision Agent - initial schema
-- Design note: this is the MVP data model. Field names track the logical
-- entities in the requirements doc (11章 データモデル) at reduced scope.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- admin | member | viewer
  title TEXT,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  note TEXT,
  created_by TEXT NOT NULL,
  expires_at TEXT,
  used_by TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  use_case TEXT NOT NULL DEFAULT 'UC-01', -- UC-01..UC-10
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | needs_review | completed
  area_ha REAL,
  elevation_min INTEGER,
  elevation_max INTEGER,
  center_lat REAL,
  center_lng REAL,
  boundary_geojson TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  label TEXT NOT NULL,
  lat REAL,
  lng REAL,
  rank INTEGER,
  score INTEGER,
  habitat_overlap REAL,
  protected_area_distance_km REAL,
  connectivity_impact TEXT,
  ndre_change_pct REAL,
  alphaearth_similarity REAL,
  access_distance_km REAL,
  access_rating TEXT,
  confidence TEXT, -- 高 | 中 | 低
  evidence_basis TEXT, -- 衛星推定 | 現地確認済み | 専門家確認済み (comma list)
  field_records_count INTEGER DEFAULT 0,
  recommended_action TEXT,
  analysis_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE mitigation_measures (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES site_candidates(id),
  hierarchy_stage TEXT NOT NULL, -- avoid | reduce | restore | offset
  description TEXT NOT NULL,
  priority INTEGER NOT NULL,
  cost_impact TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL, -- user | assistant | system
  content TEXT NOT NULL,
  steps_json TEXT, -- serialized analysis step timeline shown in UI
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE usage_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL, -- YYYY-MM (UTC)
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  cost_jpy REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_usage_log_month ON usage_log(month);

CREATE TABLE decision_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | reviewed | approved
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE report_reviewers (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES decision_reports(id),
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  decided_at TEXT
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_events_created_at ON audit_events(created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('monthly_budget_jpy', '5000'),
  ('usd_jpy_rate', '155'),
  ('claude_model', 'claude-sonnet-5');
