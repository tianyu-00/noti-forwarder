CREATE TABLE devices (
  device_id   text PRIMARY KEY,
  name        text NOT NULL,
  model       text,
  app_version text,
  token_hash  text NOT NULL UNIQUE,
  paired_at   timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz,
  revoked_at  timestamptz
);

CREATE TABLE messages (
  id          uuid PRIMARY KEY,
  device_id   text NOT NULL REFERENCES devices(device_id),
  type        text NOT NULL CHECK (type IN ('sms', 'notification')),
  app         text NOT NULL,
  sender      text NOT NULL DEFAULT '',
  body        text NOT NULL,
  received_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  dedupe_hash text NOT NULL UNIQUE
);

CREATE INDEX messages_received_at_idx ON messages (received_at DESC, id);
CREATE INDEX messages_device_received_idx ON messages (device_id, received_at DESC);
