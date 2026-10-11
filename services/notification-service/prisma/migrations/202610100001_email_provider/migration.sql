-- W7-A1: invitation e-mails are delivered through the EMAIL provider.
ALTER TYPE notification."NotificationProvider" ADD VALUE IF NOT EXISTS 'EMAIL';
