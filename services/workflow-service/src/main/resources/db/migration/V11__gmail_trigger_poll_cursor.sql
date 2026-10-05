-- trigger.gmail: per-trigger polling cursor (additive). TIMESTAMPTZ like next_run_at: it holds the newest
-- Gmail internalDate already admitted; null for every other trigger type. workflow_triggers has no CHECK on
-- type/status, so the new GMAIL type needs no constraint change.
ALTER TABLE workflow_triggers ADD COLUMN poll_cursor TIMESTAMPTZ;
