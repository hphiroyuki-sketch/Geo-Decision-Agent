-- Additive, versioned preparation notes. Previous Workers remain compatible.
CREATE TABLE disclosure_entries (
  project_id TEXT NOT NULL REFERENCES projects(id),
  framework TEXT NOT NULL CHECK(framework IN ('tnfd','site')),
  code TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  evidence TEXT NOT NULL,
  owner TEXT NOT NULL,
  due TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready')),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, framework, code, version)
);
