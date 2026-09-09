-- Preserve the original media and receipt metadata; this does not prove physical presence.
ALTER TABLE field_records ADD COLUMN media_sha256 TEXT;
ALTER TABLE field_records ADD COLUMN location_source TEXT;
