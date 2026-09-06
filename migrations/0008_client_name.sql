-- The company a screening is being produced for. Shown on the report cover, so
-- a document handed to a client says whose sites it describes.
ALTER TABLE projects ADD COLUMN client_name TEXT;
