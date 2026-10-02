CREATE SCHEMA IF NOT EXISTS notification;
CREATE TYPE notification."NotificationProvider" AS ENUM ('TELEGRAM', 'EXPO_PUSH');
CREATE TYPE notification."NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');
CREATE TABLE notification.notification_deliveries (
  id UUID PRIMARY KEY, user_id UUID NOT NULL, execution_id UUID, source_event_id UUID,
  provider notification."NotificationProvider" NOT NULL, destination VARCHAR(512) NOT NULL,
  event_type VARCHAR(128) NOT NULL, payload JSONB NOT NULL,
  status notification."NotificationStatus" NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0), last_error JSONB,
  read_at TIMESTAMPTZ(3), scheduled_at TIMESTAMPTZ(3), sent_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX notification_deliveries_event_recipient_key
  ON notification.notification_deliveries(source_event_id, user_id, provider, destination);
CREATE INDEX notification_deliveries_user_id_created_at_id_idx ON notification.notification_deliveries(user_id, created_at, id);
CREATE INDEX notification_deliveries_user_id_read_at_created_at_idx ON notification.notification_deliveries(user_id, read_at, created_at);
CREATE INDEX notification_deliveries_status_scheduled_at_idx ON notification.notification_deliveries(status, scheduled_at);
