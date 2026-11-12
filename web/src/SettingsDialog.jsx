import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import EncryptionSection from './EncryptionSection.jsx';
import { Button, Modal } from './ui.jsx';

const MAX_DAYS = 3650;

function RetentionForm({ onPurged }) {
  const [loaded, setLoaded] = useState(false);
  const [limited, setLimited] = useState(false);
  const [days, setDays] = useState('30');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let stale = false;
    api('/settings')
      .then((s) => {
        if (stale) return;
        setLimited(s.retentionDays !== null);
        if (s.retentionDays !== null) setDays(String(s.retentionDays));
        setLoaded(true);
      })
      .catch(() => {
        if (!stale) setError('Could not load settings.');
      });
    return () => {
      stale = true;
    };
  }, []);

  async function save() {
    setError(null);
    setResult(null);
    try {
      const saved = await api('/settings', {
        method: 'PUT',
        body: { retentionDays: limited ? Number(days) : null },
      });
      setConfirming(false);
      setResult(saved.purged > 0 ? `Saved. Deleted ${saved.purged} old messages.` : 'Saved.');
      if (saved.purged > 0) onPurged();
    } catch {
      setConfirming(false);
      setError('Could not save the setting.');
    }
  }

  function submit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!limited) {
      save();
      return;
    }
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
      setError(`Enter a whole number of days between 1 and ${MAX_DAYS}.`);
      return;
    }
    setConfirming(true);
  }

  if (!loaded && !error) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <fieldset className="space-y-3 text-sm">
        <legend className="mb-2 text-sm font-semibold">How long to keep messages</legend>
        <label className="flex items-center gap-2.5">
          <input type="radio" name="retention" className="accent-[var(--primary)]" checked={!limited} onChange={() => setLimited(false)} />
          Keep messages forever
        </label>
        <label className="flex flex-wrap items-center gap-2.5">
          <input type="radio" name="retention" className="accent-[var(--primary)]" checked={limited} onChange={() => setLimited(true)} />
          Delete messages older than
          <input
            type="number"
            aria-label="days"
            min={1}
            max={MAX_DAYS}
            value={days}
            disabled={!limited}
            onChange={(e) => setDays(e.target.value)}
            className="w-20 rounded-md border border-line bg-bg px-2 py-1 text-sm text-fg disabled:opacity-50"
          />
          days
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && <p className="text-sm text-ok">{result}</p>}

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
          <p>
            Messages older than {Number(days)} days are deleted now and then every hour. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={save}>
              Yes, save
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit">Save</Button>
      )}
    </form>
  );
}

RetentionForm.propTypes = { onPurged: PropTypes.func.isRequired };

export default function SettingsDialog({ open, onOpenChange, onPurged }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Settings" description="Message retention applies to every phone.">
      <RetentionForm onPurged={onPurged} />
      <EncryptionSection />
    </Modal>
  );
}

SettingsDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  onPurged: PropTypes.func.isRequired,
};
