-- Two-factor login (TOTP). users.totp_secret already exists; it holds the secret while
-- setup is pending and after it is enabled. Additive: users without 2FA are unaffected.
ALTER TABLE users
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step  bigint;

-- One-use recovery codes, stored only as hashes.
CREATE TABLE totp_backup_codes (
  code_hash text PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at   timestamptz
);
