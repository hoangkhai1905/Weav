-- Cross-workspace admin run listing (UC028) orders by created_at; additive.
CREATE INDEX IF NOT EXISTS idx_workflow_executions_created ON workflow_executions (created_at DESC);
