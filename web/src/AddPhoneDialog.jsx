import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { QRCodeSVG } from "qrcode.react";
import { useE2eKey } from "./keyStore.js";
import { withKey } from "./pairingPayload.js";
import { api } from "./api.js";
import { deviceShape } from "./Sidebar.jsx";
import { Button, Modal } from "./ui.jsx";

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const ROLES = [
  {
    value: "sender",
    label: "Sender",
    hint: "Forwards this phone's notifications and texts",
  },
  {
    value: "receiver",
    label: "Receiver",
    hint: "Shows your alerts, on your main phone",
  },
];

function RoleChoice({ role, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-muted">What will this phone do?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((r) => (
          <label
            key={r.value}
            className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm ${
              role === r.value ? "border-accent bg-surface" : "border-line"
            }`}
          >
            <span className="flex items-center gap-2 font-medium text-fg">
              <input
                type="radio"
                name="phone-role"
                value={r.value}
                checked={role === r.value}
                onChange={() => onChange(r.value)}
              />
              {r.label}
            </span>
            <span className="pl-6 text-xs text-muted">{r.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

RoleChoice.propTypes = {
  role: PropTypes.oneOf(["sender", "receiver"]).isRequired,
  onChange: PropTypes.func.isRequired,
};

function PairingPanel({
  devices,
  onDevicesLoaded,
  onClose,
  timing,
  role,
  onRoleChange,
}) {
  // Phones known when the dialog opened: any other phone appearing means pairing worked.
  const [knownIds] = useState(() => new Set(devices.map((d) => d.deviceId)));
  const e2eKey = useE2eKey();
  const [attempt, setAttempt] = useState(0);
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stale = false;
    api("/pairing-codes", { method: "POST", body: { role } })
      .then((p) => {
        if (stale) return;
        setNow(Date.now()); // the clock state may predate the response by up to a second
        setPairing(p);
      })
      .catch(() => {
        if (!stale) setError("Could not create a pairing code. Try again.");
      });
    return () => {
      stale = true;
    };
  }, [attempt, role]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function chooseRole(next) {
    if (next === role) return;
    setPairing(null);
    setError(null);
    onRoleChange(next);
  }

  function newCode() {
    setPairing(null);
    setError(null);
    setAttempt((n) => n + 1);
  }

  // A new phone has an id we have not seen. A phone pairing again keeps its id but its
  // pairedAt moves past the moment this code was created.
  const connected = devices.find(
    (d) =>
      !knownIds.has(d.deviceId) ||
      (pairing?.createdAt &&
        new Date(d.pairedAt).getTime() >=
          new Date(pairing.createdAt).getTime()),
  );
  const expired = pairing
    ? new Date(pairing.expiresAt).getTime() - now <= 0
    : false;
  const waiting = Boolean(pairing) && !expired && !connected;

  // Check the phone list while waiting, so success shows even if the live stream is blocked.
  useEffect(() => {
    if (!waiting) return undefined;
    let stale = false;
    const timer = setInterval(() => {
      api("/devices")
        .then((d) => {
          if (!stale) onDevicesLoaded(d.devices);
        })
        .catch(() => {}); // a missed check is retried on the next tick
    }, timing.pollMs);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [waiting, onDevicesLoaded, timing.pollMs]);

  // Leave the confirmation on screen briefly, then close.
  useEffect(() => {
    if (!connected) return undefined;
    const timer = setTimeout(onClose, timing.closeMs);
    return () => clearTimeout(timer);
  }, [connected, onClose, timing.closeMs]);

  if (connected) {
    return (
      <p role="status" className="text-ok">
        ✓ {connected.name} connected.
      </p>
    );
  }
  const choice = <RoleChoice role={role} onChange={chooseRole} />;
  if (error) {
    return (
      <div className="space-y-3">
        {choice}
        <p role="alert" className="text-danger">
          {error}
        </p>
        <Button variant="secondary" onClick={newCode}>
          Try again
        </Button>
      </div>
    );
  }
  if (!pairing)
    return (
      <div className="space-y-3">
        {choice}
        <p className="text-sm text-muted">Creating code…</p>
      </div>
    );

  const remaining = new Date(pairing.expiresAt).getTime() - now;
  if (expired) {
    return (
      <div className="space-y-3">
        {choice}
        <p className="text-sm text-fg">This code has expired.</p>
        <Button onClick={newCode}>New code</Button>
      </div>
    );
  }

  const { u: serverUrl } = JSON.parse(pairing.qrPayload);
  return (
    <div className="space-y-3">
      {choice}
      <div className="inline-block rounded-lg border border-line bg-white p-3">
        <QRCodeSVG
          value={withKey(pairing.qrPayload, e2eKey)}
          size={192}
          role="img"
          aria-label="Pairing QR code"
        />
      </div>
      <dl className="space-y-1 text-sm">
        <dt className="text-muted">Server address</dt>
        <dd className="break-all font-mono">{serverUrl}</dd>
        <dt className="pt-2 text-muted">Security key</dt>
        <dd className="break-all font-mono text-lg tracking-wide">
          {pairing.code}
        </dd>
        {e2eKey && (
          <>
            <dt className="pt-2 text-muted">
              Encryption key (for typing by hand)
            </dt>
            <dd className="break-all font-mono">{e2eKey}</dd>
          </>
        )}
      </dl>
      {!e2eKey && (
        <p className="text-xs text-muted">
          This phone&apos;s messages will not be encrypted. To encrypt them,
          turn on end-to-end encryption in Settings, then make a new code.
        </p>
      )}
      <p role="status" className="text-sm text-muted">
        Waiting for the phone to scan…
      </p>
      <p className="text-xs text-faint">
        Expires in {formatRemaining(remaining)}. Single use.
      </p>
    </div>
  );
}

const timingShape = PropTypes.shape({
  pollMs: PropTypes.number,
  closeMs: PropTypes.number,
});

PairingPanel.propTypes = {
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  onDevicesLoaded: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  timing: timingShape.isRequired,
  role: PropTypes.oneOf(["sender", "receiver"]).isRequired,
  onRoleChange: PropTypes.func.isRequired,
};

export const DEFAULT_PAIRING_TIMING = { pollMs: 2000, closeMs: 2500 };

export default function AddPhoneDialog({
  open,
  onOpenChange,
  devices,
  onDevicesLoaded,
  timing,
}) {
  const [role, setRole] = useState("sender");
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add phone"
      description={
        role === "receiver"
          ? "On your main phone, open the Notiforwarder app, choose Receiver, then scan this code or type the server address and security key."
          : "In the Notiforwarder app, choose Sender, then scan this code or type the server address and security key."
      }
    >
      <PairingPanel
        devices={devices}
        onDevicesLoaded={onDevicesLoaded}
        onClose={() => onOpenChange(false)}
        timing={{ ...DEFAULT_PAIRING_TIMING, ...timing }}
        role={role}
        onRoleChange={setRole}
      />
    </Modal>
  );
}

AddPhoneDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  onDevicesLoaded: PropTypes.func.isRequired,
  timing: timingShape,
};
