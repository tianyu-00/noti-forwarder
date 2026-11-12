import { useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import { deviceShape } from './Sidebar.jsx';
import { Button, Modal, inputClass } from './ui.jsx';

function Confirm({ children, yes, onYes, onCancel }) {
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="text-fg">{children}</p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={onYes}>
          {yes}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

Confirm.propTypes = {
  children: PropTypes.node.isRequired,
  yes: PropTypes.string.isRequired,
  onYes: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

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
      <form onSubmit={rename} className="space-y-3">
        <label className="block space-y-1.5 text-sm font-medium">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} />
        </label>
        <Button type="submit">Save</Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="space-y-3 border-t border-line pt-5">
        {device.revokedAt ? (
          <>
            <p className="text-sm text-muted">This phone has been revoked.</p>
            {confirmingErase ? (
              <Confirm yes="Yes, erase" onYes={erase} onCancel={() => setConfirmingErase(false)}>
                Erase {device.name} and every message it sent? This cannot be undone.
              </Confirm>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmingErase(true)}>
                Erase this phone and its messages
              </Button>
            )}
          </>
        ) : confirming ? (
          <Confirm yes="Yes, revoke" onYes={revoke} onCancel={() => setConfirming(false)}>
            Revoke {device.name}? It will stop sending and must be paired again. Messages already received are kept.
          </Confirm>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Revoke this phone
          </Button>
        )}
      </div>
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={device.name}
      description={
        [device.model, device.appVersion && `app ${device.appVersion}`].filter(Boolean).join(' · ') ||
        'Rename or revoke this phone.'
      }
    >
      <Panel
        device={device}
        onRenamed={onRenamed}
        onRevoked={onRevoked}
        onErased={onErased}
        onDone={() => onOpenChange(false)}
      />
    </Modal>
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
