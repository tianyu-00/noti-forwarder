-- Dual-SIM phones. `devices.sims` is the SIM list the phone reports (JSON text: id, slot, name, allowed),
-- NULL until it has reported. `messages.sim` is the SIM (the phone's subscription id) that received a text,
-- and `outbox.sim` the SIM a reply should go out on. All three are optional so older phones keep working.
ALTER TABLE devices ADD COLUMN sims text;
ALTER TABLE messages ADD COLUMN sim integer;
ALTER TABLE outbox ADD COLUMN sim integer;
