-- Responses from the public datasets the screening consults.
--
-- Cached because they are stable on the timescale of a screening, because the
-- Worker has a 50-subrequest budget per request, and because Overpass is a
-- shared community service that should not be asked the same question twice.
--
-- `status` is stored alongside the payload so a failure is a recorded fact
-- rather than an absence: a report that silently omits a source it could not
-- reach reads as "nothing found there", which is the opposite of the truth.
CREATE TABLE public_data_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- gbif | osm_protected | gsi_hazard
  lat REAL NOT NULL,             -- rounded to ~100m so nearby sites share a row
  lng REAL NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL,          -- ok | failed | empty
  error TEXT,
  fetched_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_public_data_cache_key ON public_data_cache(source, lat, lng);
