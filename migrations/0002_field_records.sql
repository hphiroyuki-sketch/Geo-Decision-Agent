-- Field data capture (FieldRecord entity, 11章) - smartphone photo + GPS + species
-- observations that get cross-referenced against satellite embedding similarity.

CREATE TABLE field_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  observer_id TEXT NOT NULL REFERENCES users(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  gps_accuracy_m REAL,
  species_guess TEXT,
  taxon_confidence TEXT, -- 高 | 中 | 低 (observer's own confidence in the ID)
  notes TEXT,
  photo_key TEXT, -- R2 object key, null if no photo attached
  photo_content_type TEXT,
  captured_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed', -- unreviewed | confirmed | rejected
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_field_records_project ON field_records(project_id);

-- Cache of Satellite Embedding vectors fetched from Google Earth Engine, keyed by
-- rounded coordinate + year, so repeated analyses of the same area don't re-fetch.
CREATE TABLE embedding_cache (
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  year INTEGER NOT NULL,
  vector_json TEXT NOT NULL, -- JSON array of 64 floats (A00-A63)
  source TEXT NOT NULL DEFAULT 'earth_engine', -- earth_engine | simulated
  fetched_at TEXT NOT NULL
);

CREATE INDEX idx_embedding_cache_lookup ON embedding_cache(lat, lng, year);

INSERT INTO settings (key, value) VALUES ('earth_engine_year', '2024');
