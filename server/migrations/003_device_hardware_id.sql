-- Lets a phone that pairs again be recognised and reuse its device row.
-- Nullable and additive: older app versions that send no id keep working.
ALTER TABLE devices ADD COLUMN hardware_id text;

CREATE UNIQUE INDEX devices_hardware_id_key ON devices (hardware_id) WHERE hardware_id IS NOT NULL;
