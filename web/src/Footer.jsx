import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function Footer() {
  const [server, setServer] = useState(null);

  useEffect(() => {
    api('/health')
      .then(setServer)
      .catch(() => setServer(null));
  }, []);

  return (
    <footer className="border-t border-line p-4 text-xs text-faint">
      Web {__APP_VERSION__}
      {server && ` · Server ${server.version} (${server.commit})`}
    </footer>
  );
}
