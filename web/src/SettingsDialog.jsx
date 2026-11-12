import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from './api.js';
import SecuritySection from './SecuritySection.jsx';

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

  if (!loaded && !error) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 font-medium">How long to keep messages</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="retention" checked={!limited} onChange={() => setLimited(false)} />
          Keep messages forever
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="retention" checked={limited} onChange={() => setLimited(true)} />
          Delete messages older than
          <input
            type="number"
            aria-label="days"
            min={1}
            max={MAX_DAYS}
            value={days}
            disabled={!limited}
            onChange={(e) => setDays(e.target.value)}
            className="w-20 rounded bg-slate-700 p-1 disabled:opacity-50"
          />
          days
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {result && <p className="text-sm text-emerald-400">{result}</p>}

      {confirming ? (
        <div className="space-y-2 rounded border border-red-500/40 p-3 text-sm">
          <p>
            Messages older than {Number(days)} days are deleted now and then every hour. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={save} className="rounded bg-red-600 px-3 py-1">
              Yes, save
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded bg-slate-700 px-3 py-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="submit" className="rounded bg-sky-600 px-3 py-1 text-sm">
          Save
        </button>
      )}
    </form>
  );
}

RetentionForm.propTypes = { onPurged: PropTypes.func.isRequired };

export default function SettingsDialog({ open, onOpenChange, onPurged }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-h-[90vh] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg bg-slate-800 p-6 text-slate-100">
          <Dialog.Title className="text-lg font-semibold">Settings</Dialog.Title>
          <Dialog.Description className="text-sm text-slate-400">
            Message retention applies to every phone.
          </Dialog.Description>
          <RetentionForm onPurged={onPurged} />
          <SecuritySection />
          <Dialog.Close className="rounded bg-slate-700 px-3 py-1 text-sm">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

SettingsDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  onPurged: PropTypes.func.isRequired,
};
