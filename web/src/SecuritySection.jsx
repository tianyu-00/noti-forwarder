import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from './api.js';

// Two-step login (an authenticator app). Steps: off -> scan and confirm -> save backup codes -> on.
export default function SecuritySection() {
  const [enabled, setEnabled] = useState(null); // null while loading
  const [step, setStep] = useState('idle'); // idle | scan | codes | disabling
  const [setup, setSetup] = useState(null);
  const [backupCodes, setBackupCodes] = useState([]);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let stale = false;
    api('/auth/me')
      .then((me) => {
        if (!stale) setEnabled(Boolean(me.totpEnabled));
      })
      .catch(() => {
        if (!stale) setError('Could not load the two-step login status.');
      });
    return () => {
      stale = true;
    };
  }, []);

  function reset(next = 'idle') {
    setStep(next);
    setCode('');
    setPassword('');
    setError(null);
  }

  async function begin() {
    setError(null);
    try {
      setSetup(await api('/auth/totp/setup', { method: 'POST', body: {} }));
      reset('scan');
    } catch {
      setError('Could not start the setup.');
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError(null);
    try {
      const done = await api('/auth/totp/enable', { method: 'POST', body: { code: code.trim() } });
      setBackupCodes(done.backupCodes);
      setSetup(null);
      reset('codes');
    } catch {
      setError('That code was not correct. Check the code in your app and try again.');
    }
  }

  async function turnOff(e) {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/totp/disable', { method: 'POST', body: { password, code: code.trim() } });
      setEnabled(false);
      reset('idle');
    } catch {
      setError('The password or code was not correct.');
    }
  }

  if (enabled === null) {
    return error ? (
      <p role="alert" className="text-sm text-red-400">
        {error}
      </p>
    ) : null;
  }

  const input = 'mt-1 w-full rounded bg-slate-700 p-2';
  return (
    <section className="space-y-3 border-t border-slate-700 pt-4 text-sm" aria-label="Two-step login">
      <h3 className="font-medium">Two-step login</h3>

      {step === 'idle' && (
        <>
          <p className="text-slate-300">{enabled ? 'Two-step login is on.' : 'Two-step login is off.'}</p>
          {enabled ? (
            <button type="button" onClick={() => reset('disabling')} className="rounded bg-slate-700 px-3 py-1">
              Turn off
            </button>
          ) : (
            <button type="button" onClick={begin} className="rounded bg-sky-600 px-3 py-1">
              Turn on
            </button>
          )}
        </>
      )}

      {step === 'scan' && setup && (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-slate-300">
            Scan this with an authenticator app (Google Authenticator, Authy, 1Password…), then enter the code it shows.
          </p>
          <div className="inline-block rounded bg-white p-2">
            <QRCodeSVG value={setup.otpauthUri} size={160} role="img" aria-label="Authenticator QR code" />
          </div>
          <p className="text-slate-400">
            Or type this key into the app: <span className="select-all break-all font-mono text-slate-200">{setup.secret}</span>
          </p>
          <label className="block">
            6-digit code
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className={input} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-sky-600 px-3 py-1">
              Confirm
            </button>
            <button type="button" onClick={() => reset('idle')} className="rounded bg-slate-700 px-3 py-1">
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'codes' && (
        <div className="space-y-3">
          <p className="text-slate-300">
            Two-step login is on. Save these backup codes now. Each works once if you lose your phone, and they are not shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1 rounded bg-slate-900 p-3 font-mono">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setBackupCodes([]);
              setEnabled(true);
              reset('idle');
            }}
            className="rounded bg-sky-600 px-3 py-1"
          >
            I have saved them
          </button>
        </div>
      )}

      {step === 'disabling' && (
        <form onSubmit={turnOff} className="space-y-3">
          <p className="text-slate-300">Enter your password and a current code (or a backup code) to turn it off.</p>
          <label className="block">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={input} />
          </label>
          <label className="block">
            Code
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className={input} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-red-600 px-3 py-1">
              Confirm turn off
            </button>
            <button type="button" onClick={() => reset('idle')} className="rounded bg-slate-700 px-3 py-1">
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
