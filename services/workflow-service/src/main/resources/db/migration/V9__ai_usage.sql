-- AI-2: per-workspace daily AI call counter (UTC day). Only written when weav.workflow.ai.daily-limit-per-workspace > 0.
CREATE TABLE ai_usage (
    workspace_id UUID NOT NULL,
    usage_date   DATE NOT NULL,
    call_count   INT  NOT NULL,
    PRIMARY KEY (workspace_id, usage_date)
);
