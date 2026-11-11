import { useEffect, useState } from 'react';
import { api, setCsrfToken } from './api.js';
import Login from './Login.jsx';

export default function App() {
  const [session, setSession] = useState({ status: 'loading' });

  useEffect(() => {
    api('/auth/me')
      .then((me) => {
        setCsrfToken(me.csrfToken);
        setSession({ status: 'in', username: me.username });
      })
      .catch(() => setSession({ status: 'out' }));
  }, []);

  if (session.status === 'loading') return null;
  if (session.status === 'out') return <Login onSubmit={() => {}} />;
  return <p>Signed in as {session.username}</p>;
}
