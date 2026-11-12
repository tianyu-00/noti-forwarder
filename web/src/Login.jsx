import { useState } from 'react';
import PropTypes from 'prop-types';
import { Button, inputClass } from './ui.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function Login({ onSubmit, error, needsCode = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        className="w-full max-w-sm space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(needsCode ? { username, password, code: code.trim() } : { username, password });
        }}
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight text-muted">Notiforwarder</p>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h1>
        </div>
        {!window.isSecureContext && (
          <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm text-muted">
            This page is not using HTTPS, so your browser will not keep you signed in and you will have to sign
            in again after every refresh. Open the dashboard through its https:// address.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <label className="block space-y-1.5 text-sm font-medium text-fg">
          Username
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="block space-y-1.5 text-sm font-medium text-fg">
          Password
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {needsCode && (
          <label className="block space-y-1.5 text-sm font-medium text-fg">
            Authenticator or backup code
            <input
              className={`${inputClass} tracking-widest`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="text"
              autoFocus
            />
          </label>
        )}
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}

Login.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  error: PropTypes.string,
  needsCode: PropTypes.bool,
};
