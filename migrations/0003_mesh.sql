-- FR-020 10m mesh, FR-026 hotspots, FR-054 recovery plans.

-- One row per grid cell. Cells are addressed by their integer row/col within a
-- mesh so neighbour lookups (hotspot flood fill) are plain arithmetic.
CREATE TABLE meshes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  cell_size_m INTEGER NOT NULL,      -- 10 by default (FR-020)
  extent_m INTEGER NOT NULL,         -- edge length of the square AOI
  row_count INTEGER NOT NULL,
  col_count INTEGER NOT NULL,
  year INTEGER NOT NULL,
  detect_change INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'sampling', -- sampling | ready | failed
  reference_points INTEGER NOT NULL DEFAULT 0, -- confirmed field records behind the reference vector
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE mesh_cells (
  id TEXT PRIMARY KEY,
  mesh_id TEXT NOT NULL REFERENCES meshes(id),
  row_idx INTEGER NOT NULL,
  col_idx INTEGER NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  min_lat REAL NOT NULL,
  min_lng REAL NOT NULL,
  max_lat REAL NOT NULL,
  max_lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sampled | failed
  reference_similarity REAL,   -- cosine to the confirmed-habitat reference vector
  change_score REAL,           -- 1 - cosine(year, year-1); higher = bigger change
  cell_class TEXT,             -- priority_a | similar | changed | baseline | unscored
  field_records INTEGER NOT NULL DEFAULT 0,
  hotspot_id TEXT,
  error TEXT,
  sampled_at TEXT
);

CREATE INDEX idx_mesh_cells_mesh ON mesh_cells(mesh_id, status);
CREATE INDEX idx_mesh_cells_class ON mesh_cells(mesh_id, cell_class);

-- FR-026: adjacent cells of the same class, grouped and ranked.
CREATE TABLE mesh_hotspots (
  id TEXT PRIMARY KEY,
  mesh_id TEXT NOT NULL REFERENCES meshes(id),
  cell_class TEXT NOT NULL,
  rank INTEGER NOT NULL,
  cell_count INTEGER NOT NULL,
  area_ha REAL NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  mean_similarity REAL,
  mean_change REAL,
  compactness REAL,            -- 0-1; higher = more contiguous, less fragmented
  importance REAL NOT NULL,
  field_records INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_mesh_hotspots_mesh ON mesh_hotspots(mesh_id, rank);

-- FR-054 recovery plan / FR-052 mitigation hierarchy, anchored to a hotspot so
-- every measure names the ground it applies to.
CREATE TABLE recovery_actions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  mesh_id TEXT NOT NULL REFERENCES meshes(id),
  hotspot_id TEXT NOT NULL REFERENCES mesh_hotspots(id),
  stage TEXT NOT NULL,          -- avoid | reduce | restore | offset
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  expected_change TEXT NOT NULL,
  indicator TEXT NOT NULL,
  frequency TEXT NOT NULL,
  area_ha REAL NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  priority INTEGER NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | accepted | in_progress | done | rejected
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_recovery_actions_project ON recovery_actions(project_id, status);

INSERT INTO settings (key, value) VALUES
  ('mesh_cell_size_m', '10'),
  ('mesh_extent_m', '200');
