-- The app's real name as the phone shows it ("Gmail"), next to the package name in `app`.
-- Nullable and additive: older app versions send no name and keep working, and older rows stay null.
ALTER TABLE messages ADD COLUMN app_label text;
