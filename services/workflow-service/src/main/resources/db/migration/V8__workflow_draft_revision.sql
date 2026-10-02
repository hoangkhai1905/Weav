-- WF-8: optimistic concurrency for draft saves (additive; existing rows start at revision 0).
ALTER TABLE workflows
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
