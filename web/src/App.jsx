import { useEffect, useState } from 'react';
import { api, setCsrfToken } from './api.js';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';

const LOGIN_ERRORS = {
  429: 'Too many attempts. Try again in a few minutes.',
  default: 'Incorrect username or password.',
};

export default function App() {
  const [session, setSession] = useState({ status: 'loading' });
  const [loginError, setLoginError] = useState(null);

  useEffect(() => {
    api('/auth/me')
      .then((me) => {
        setCsrfToken(me.csrfToken);
        setSession({ status: 'in', username: me.username });
      })
      .catch(() => setSession({ status: 'out' }));
  }, []);

  async function login(credentials) {
    setLoginError(null);
    try {
      const me = await api('/auth/login', { method: 'POST', body: credentials });
      setCsrfToken(me.csrfToken);
      setSession({ status: 'in', username: me.username });
    } catch (err) {
      setLoginError(LOGIN_ERRORS[err.status] ?? LOGIN_ERRORS.default);
    }
  }

  if (session.status === 'loading') return null;
  if (session.status === 'out') return <Login onSubmit={login} error={loginError} />;
  return <Dashboard username={session.username} />;
}
