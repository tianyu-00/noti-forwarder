import { useState } from 'react';
import PropTypes from 'prop-types';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from './api.js';
import { deviceShape } from './Sidebar.jsx';

function Panel({ device, onRenamed, onRevoked, onErased, onDone }) {
  const [name, setName] = useState(device.name);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingErase, setConfirmingErase] = useState(false);

  async function rename(e) {
    e.preventDefault();
    setError(null);
    try {
      onRenamed(await api(`/devices/${device.deviceId}`, { method: 'PATCH', body: { name } }));
      onDone();
    } catch {
      setError('Could not rename the phone.');
    }
  }

  async function revoke() {
    setError(null);
    try {
      await api(`/devices/${device.deviceId}`, { method: 'DELETE' });
      onRevoked(device.deviceId);
      onDone();
    } catch {
      setError('Could not revoke the phone.');
    }
  }

  async function erase() {
    setError(null);
    try {
      await api(`/devices/${device.deviceId}/permanent`, { method: 'DELETE' });
      onErased(device.deviceId);
      onDone();
    } catch {
      setError('Could not erase the phone.');
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={rename} className="space-y-2">
        <label className="block text-sm">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="mt-1 w-full rounded bg-slate-700 p-2"
          />
        </label>
        <button type="submit" className="rounded bg-sky-600 px-3 py-1 text-sm">
          Save
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {device.revokedAt ? (
        <div className="space-y-2 text-sm">
          <p className="text-slate-400">This phone has been revoked.</p>
          {confirmingErase ? (
            <div className="space-y-2 rounded border border-red-500/40 p-3">
              <p>
                Erase {device.name} and every message it sent? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={erase} className="rounded bg-red-600 px-3 py-1">
                  Yes, erase
                </button>
                <button type="button" onClick={() => setConfirmingErase(false)} className="rounded bg-slate-700 px-3 py-1">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingErase(true)} className="rounded bg-red-600/80 px-3 py-1">
              Erase this phone and its messages
            </button>
          )}
        </div>
      ) : confirming ? (
        <div className="space-y-2 rounded border border-red-500/40 p-3 text-sm">
          <p>
            Revoke {device.name}? It will stop sending and must be paired again. Messages already received are kept.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={revoke} className="rounded bg-red-600 px-3 py-1">
              Yes, revoke
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded bg-slate-700 px-3 py-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="rounded bg-red-600/80 px-3 py-1 text-sm">
          Revoke this phone
        </button>
      )}
    </div>
  );
}

Panel.propTypes = {
  device: deviceShape.isRequired,
  onRenamed: PropTypes.func.isRequired,
  onRevoked: PropTypes.func.isRequired,
  onErased: PropTypes.func.isRequired,
  onDone: PropTypes.func.isRequired,
};

export default function ManagePhoneDialog({ device, open, onOpenChange, onRenamed, onRevoked, onErased }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg bg-slate-800 p-6 text-slate-100">
          <Dialog.Title className="text-lg font-semibold">{device.name}</Dialog.Title>
          <Dialog.Description className="text-sm text-slate-400">
            {[device.model, device.appVersion && `app ${device.appVersion}`].filter(Boolean).join(' · ') ||
              'Rename or revoke this phone.'}
          </Dialog.Description>
          <Panel device={device} onRenamed={onRenamed} onRevoked={onRevoked} onErased={onErased} onDone={() => onOpenChange(false)} />
          <Dialog.Close className="rounded bg-slate-700 px-3 py-1 text-sm">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

ManagePhoneDialog.propTypes = {
  device: deviceShape.isRequired,
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  onRenamed: PropTypes.func.isRequired,
  onRevoked: PropTypes.func.isRequired,
  onErased: PropTypes.func.isRequired,
};
