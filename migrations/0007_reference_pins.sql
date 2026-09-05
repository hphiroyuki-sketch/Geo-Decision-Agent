-- Reference points designated on the map, as distinct from field observations.
--
-- Similarity is measured against confirmed field records, which makes the
-- product unusable until somebody has walked the site - and useless when the
-- only records are 400km from the area being analysed, which is exactly what
-- happened. Letting a user point at habitat on the satellite image solves that.
--
-- But a pin dropped on imagery is not the same evidence as a photograph taken
-- standing there, and must never be counted as one. Hence a source column
-- rather than reusing field records silently: pins seed the reference vector,
-- and every place that counts or labels evidence can tell the two apart.
ALTER TABLE field_records ADD COLUMN source TEXT NOT NULL DEFAULT 'field';

CREATE INDEX idx_field_records_source ON field_records(project_id, source);
