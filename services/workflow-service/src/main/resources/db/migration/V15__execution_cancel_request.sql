-- W6-C3: a user asks to stop a run. The runner holding the lease checks this flag between nodes.
-- Additive only; existing rows keep NULL (no cancellation requested).
ALTER TABLE workflow_executions
    ADD COLUMN cancel_requested_at TIMESTAMPTZ;
