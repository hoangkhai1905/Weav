CREATE TABLE notification.notification_inbox (
  id UUID NOT NULL,
  dedup_key VARCHAR(128) NOT NULL,
  source_event_id UUID,
  user_id UUID NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  workspace_id UUID,
  actor_user_id UUID,
  execution_id UUID,
  content JSONB NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ(3),
  CONSTRAINT notification_inbox_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX notification_inbox_dedup_key_key
  ON notification.notification_inbox(dedup_key);
CREATE UNIQUE INDEX notification_inbox_source_event_id_user_id_key
  ON notification.notification_inbox(source_event_id, user_id);
CREATE UNIQUE INDEX notification_inbox_id_user_id_key
  ON notification.notification_inbox(id, user_id);
CREATE INDEX notification_inbox_user_id_created_at_id_idx
  ON notification.notification_inbox(user_id, created_at, id);
CREATE INDEX notification_inbox_user_id_read_at_created_at_idx
  ON notification.notification_inbox(user_id, read_at, created_at);

ALTER TABLE notification.notification_deliveries
  ADD COLUMN inbox_id UUID;
CREATE INDEX notification_deliveries_inbox_id_idx
  ON notification.notification_deliveries(inbox_id);
ALTER TABLE notification.notification_deliveries
  ADD CONSTRAINT notification_deliveries_inbox_id_user_id_fkey
  FOREIGN KEY (inbox_id, user_id)
  REFERENCES notification.notification_inbox(id, user_id)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;
