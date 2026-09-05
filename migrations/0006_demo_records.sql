-- Sample field records, marked so they can never be mistaken for observations
-- somebody actually made.
--
-- The need is real: similarity is measured against confirmed field records, so
-- a user with no records - or with every record in one spot - cannot get a
-- meaningful mesh, and has no way to see the product work before doing
-- fieldwork. The risk is equally real: a fabricated record that reads as
-- "現地確認済み" would overstate the evidence behind a siting decision.
--
-- Hence a column rather than a naming convention: demo rows are labelled
-- everywhere they appear and removable in one action.
ALTER TABLE field_records ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_field_records_demo ON field_records(project_id, demo);
