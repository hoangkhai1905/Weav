-- Expo push tokens per signed-in device. The token is the key: a phone that signs in as another
-- user moves to that user. locale picks the language the push is rendered in.
CREATE TABLE notification.push_devices (
  token VARCHAR(512) NOT NULL,
  user_id UUID NOT NULL,
  locale VARCHAR(2) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT push_devices_pkey PRIMARY KEY (token)
);

CREATE INDEX push_devices_user_id_updated_at_idx
  ON notification.push_devices(user_id, updated_at);
