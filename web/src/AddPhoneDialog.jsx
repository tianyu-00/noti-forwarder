import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import * as Dialog from '@radix-ui/react-dialog';
import { QRCodeSVG } from 'qrcode.react';
import { api } from './api.js';
import { deviceShape } from './Sidebar.jsx';

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function PairingPanel({ devices, onDevicesLoaded, onClose, timing }) {
  // Phones known when the dialog opened: any other phone appearing means pairing worked.
  const [knownIds] = useState(() => new Set(devices.map((d) => d.deviceId)));
  const [attempt, setAttempt] = useState(0);
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stale = false;
    api('/pairing-codes', { method: 'POST' })
      .then((p) => {
        if (stale) return;
        setNow(Date.now()); // the clock state may predate the response by up to a second
        setPairing(p);
      })
      .catch(() => {
        if (!stale) setError('Could not create a pairing code. Try again.');
      });
    return () => {
      stale = true;
    };
  }, [attempt]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function newCode() {
    setPairing(null);
    setError(null);
    setAttempt((n) => n + 1);
  }

  const connected = devices.find((d) => !knownIds.has(d.deviceId));
  const expired = pairing ? new Date(pairing.expiresAt).getTime() - now <= 0 : false;
  const waiting = Boolean(pairing) && !expired && !connected;

  // Check the phone list while waiting, so success shows even if the live stream is blocked.
  useEffect(() => {
    if (!waiting) return undefined;
    let stale = false;
    const timer = setInterval(() => {
      api('/devices')
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
      <p role="status" className="text-emerald-400">
        ✓ {connected.name} connected.
      </p>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-red-400">
          {error}
        </p>
        <button type="button" onClick={newCode} className="rounded bg-slate-700 px-3 py-1">
          Try again
        </button>
      </div>
    );
  }
  if (!pairing) return <p className="text-slate-400">Creating code…</p>;

  const remaining = new Date(pairing.expiresAt).getTime() - now;
  if (expired) {
    return (
      <div className="space-y-3">
        <p className="text-amber-400">This code has expired.</p>
        <button type="button" onClick={newCode} className="rounded bg-sky-600 px-3 py-1">
          New code
        </button>
      </div>
    );
  }

  const { u: serverUrl } = JSON.parse(pairing.qrPayload);
  return (
    <div className="space-y-3">
      <div className="inline-block rounded bg-white p-3">
        <QRCodeSVG value={pairing.qrPayload} size={192} role="img" aria-label="Pairing QR code" />
      </div>
      <dl className="space-y-1 text-sm">
        <dt className="text-slate-400">Server address</dt>
        <dd className="break-all font-mono">{serverUrl}</dd>
        <dt className="text-slate-400">Security key</dt>
        <dd className="break-all font-mono text-lg tracking-wide">{pairing.code}</dd>
      </dl>
      <p role="status" className="text-sm text-sky-300">
        Waiting for the phone to scan…
      </p>
      <p className="text-xs text-slate-400">Expires in {formatRemaining(remaining)}. Single use.</p>
    </div>
  );
}

const timingShape = PropTypes.shape({ pollMs: PropTypes.number, closeMs: PropTypes.number });

PairingPanel.propTypes = {
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  onDevicesLoaded: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  timing: timingShape.isRequired,
};

export const DEFAULT_PAIRING_TIMING = { pollMs: 2000, closeMs: 2500 };

export default function AddPhoneDialog({ open, onOpenChange, devices, onDevicesLoaded, timing }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg bg-slate-800 p-6 text-slate-100">
          <Dialog.Title className="text-lg font-semibold">Add phone</Dialog.Title>
          <Dialog.Description className="text-sm text-slate-400">
            In the Notiforwarder app, scan this code or type the server address and security key.
          </Dialog.Description>
          <PairingPanel
            devices={devices}
            onDevicesLoaded={onDevicesLoaded}
            onClose={() => onOpenChange(false)}
            timing={{ ...DEFAULT_PAIRING_TIMING, ...timing }}
          />
          <Dialog.Close className="rounded bg-slate-700 px-3 py-1 text-sm">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

AddPhoneDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  onDevicesLoaded: PropTypes.func.isRequired,
  timing: timingShape,
};
