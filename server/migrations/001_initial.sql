-- The whole schema, for SQLite. Times are UTC text like 2026-11-11T10:00:05.123Z (it sorts in time
-- order); ids are text. now() and gen_random_uuid() are functions the server adds to the connection
-- (src/db/sqlite.js). Later changes are numbered files after this one, and must be additive so the
-- previous release still works on the new database.

CREATE TABLE devices (
  device_id   text PRIMARY KEY,
  name        text NOT NULL,
  model       text,
  app_version text,
  token_hash  text NOT NULL UNIQUE,
  paired_at   text NOT NULL DEFAULT (now()),
  last_seen   text,
  revoked_at  text,
  -- Lets a phone that pairs again be recognised and reuse its device row.
  hardware_id text
);

CREATE UNIQUE INDEX devices_hardware_id_key ON devices (hardware_id) WHERE hardware_id IS NOT NULL;

CREATE TABLE messages (
  id          text PRIMARY KEY,
  device_id   text NOT NULL REFERENCES devices(device_id),
  type        text NOT NULL CHECK (type IN ('sms', 'notification')),
  app         text NOT NULL,
  -- The app's real name as the phone shows it ("Gmail"). Null when the phone did not send one.
  app_label   text,
  sender      text NOT NULL DEFAULT '',
  body        text NOT NULL,
  received_at text NOT NULL,
  created_at  text NOT NULL DEFAULT (now()),
  dedupe_hash text NOT NULL UNIQUE
);

CREATE INDEX messages_received_at_idx ON messages (received_at DESC, id);
CREATE INDEX messages_device_received_idx ON messages (device_id, received_at DESC);

CREATE TABLE users (
  id               text PRIMARY KEY DEFAULT (gen_random_uuid()),
  username         text NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  -- Holds the secret while two-step setup is pending and after it is enabled.
  totp_secret      text,
  totp_enabled_at  text,
  totp_last_step   integer,
  failed_logins    integer NOT NULL DEFAULT 0,
  locked_until     text,
  created_at       text NOT NULL DEFAULT (now())
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at text NOT NULL DEFAULT (now()),
  expires_at text NOT NULL
);

CREATE TABLE pairing_codes (
  code_hash  text PRIMARY KEY,
  created_at text NOT NULL DEFAULT (now()),
  expires_at text NOT NULL,
  used_at    text,
  device_id  text REFERENCES devices(device_id)
);

CREATE TABLE audit_log (
  id         integer PRIMARY KEY AUTOINCREMENT,
  event      text NOT NULL,
  actor      text,
  device_id  text,
  ip         text,
  created_at text NOT NULL DEFAULT (now())
);

-- Dashboard settings, one row per setting. The value is JSON text.
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at text NOT NULL DEFAULT (now())
);

-- One-use recovery codes for two-step login, stored only as hashes.
CREATE TABLE totp_backup_codes (
  code_hash text PRIMARY KEY,
  user_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at   text
);
