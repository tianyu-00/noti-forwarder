-- A phone is a sender (it forwards its notifications and texts) or a receiver (the main phone, which
-- shows alerts). `devices.role` says which; `pairing_codes.role` is the kind of phone a code makes.
-- Both default to 'sender', so older phones, older dashboards and a rollback keep working.
ALTER TABLE devices ADD COLUMN role text NOT NULL DEFAULT 'sender' CHECK (role IN ('sender', 'receiver'));
ALTER TABLE pairing_codes ADD COLUMN role text NOT NULL DEFAULT 'sender' CHECK (role IN ('sender', 'receiver'));
