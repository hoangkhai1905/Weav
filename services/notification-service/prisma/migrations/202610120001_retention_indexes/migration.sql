-- Retention purge (hourly, batched) scans terminal deliveries and old inbox rows by age.
CREATE INDEX IF NOT EXISTS notification_deliveries_status_created_at_idx
  ON notification.notification_deliveries(status, created_at);
CREATE INDEX IF NOT EXISTS notification_inbox_created_at_idx
  ON notification.notification_inbox(created_at);
