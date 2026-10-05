-- trigger.gmail: per-trigger polling cursor (additive). TIMESTAMPTZ like next_run_at: it holds the newest
-- Gmail internalDate already admitted; null for every other trigger type. workflow_triggers has no CHECK on
-- type/status, so the new GMAIL type needs no constraint change.
ALTER TABLE workflow_triggers ADD COLUMN poll_cursor TIMESTAMPTZ;
-- Id of the last Gmail message handled at the cursor: emails sharing one second are told apart by position.
ALTER TABLE workflow_triggers ADD COLUMN poll_cursor_message_id TEXT;
