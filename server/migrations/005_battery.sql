-- The last battery level a phone reported, and whether it was charging (0 or 1), so the dashboard and the
-- receiver can still show it after the phone goes offline. Null until a phone reports one. Older phones never
-- do, and a rollback just ignores the columns.
ALTER TABLE devices ADD COLUMN battery_percent integer CHECK (battery_percent BETWEEN 0 AND 100);
ALTER TABLE devices ADD COLUMN battery_charging integer CHECK (battery_charging IN (0, 1));
