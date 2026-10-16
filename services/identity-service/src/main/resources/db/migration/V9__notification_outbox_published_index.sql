-- Retention purge (NotificationOutboxRetentionPurgeJob) scans published rows by published_at; without this it
-- sequentially scans the whole outbox every hour. Same shape as workspace's idx_notification_outbox_published.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_published
    ON notification_outbox (published_at)
    WHERE published_at IS NOT NULL;
