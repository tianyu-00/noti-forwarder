-- Replies typed on the dashboard, waiting for their phone to send them as an SMS. `recipient` and
-- `body` hold plain text, or "e2e:v1:..." text the browser encrypted (the server cannot read it).
-- `error` is a short reason code from the phone, never any message text.
CREATE TABLE outbox (
  id         text PRIMARY KEY,
  device_id  text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  recipient  text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error      text,
  created_at text NOT NULL DEFAULT (now()),
  sent_at    text
);

CREATE INDEX outbox_device_created_idx ON outbox (device_id, created_at DESC);
