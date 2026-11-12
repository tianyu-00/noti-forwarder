import { useState } from 'react';
import PropTypes from 'prop-types';

export default function Login({ onSubmit, error, needsCode = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg bg-slate-800 p-6 text-slate-100"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(needsCode ? { username, password, code: code.trim() } : { username, password });
        }}
      >
        <h1 className="text-xl font-semibold">Sign in</h1>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <label className="block text-sm">
          Username
          <input
            className="mt-1 w-full rounded bg-slate-700 p-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded bg-slate-700 p-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {needsCode && (
          <label className="block text-sm">
            Authenticator or backup code
            <input
              className="mt-1 w-full rounded bg-slate-700 p-2 tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="text"
              autoFocus
            />
          </label>
        )}
        <button type="submit" className="w-full rounded bg-sky-600 p-2 font-medium hover:bg-sky-500">
          Sign in
        </button>
      </form>
    </main>
  );
}

Login.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  error: PropTypes.string,
  needsCode: PropTypes.bool,
};
