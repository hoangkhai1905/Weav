CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE ai.conversations (
  id UUID NOT NULL,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT conversations_pkey PRIMARY KEY (id)
);
CREATE INDEX conversations_user_workspace_updated_idx
  ON ai.conversations(user_id, workspace_id, updated_at DESC);
CREATE INDEX conversations_updated_at_idx ON ai.conversations(updated_at);

CREATE TABLE ai.messages (
  id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT messages_content_length_check CHECK (char_length(content) <= 16000),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id)
    REFERENCES ai.conversations(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX messages_conversation_created_idx
  ON ai.messages(conversation_id, created_at);

CREATE TABLE ai.assistant_usage (
  day DATE NOT NULL,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  calls INTEGER NOT NULL,
  CONSTRAINT assistant_usage_pkey PRIMARY KEY (day, workspace_id, user_id),
  CONSTRAINT assistant_usage_calls_check CHECK (calls >= 0)
);
