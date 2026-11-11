import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import MessageList from './MessageList.jsx';

export default function Dashboard({ username }) {
  const [devices, setDevices] = useState([]);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    api('/devices').then((d) => setDevices(d.devices));
    api('/messages').then((m) => setMessages(m.messages));
  }, []);

  const deviceNames = useMemo(() => Object.fromEntries(devices.map((d) => [d.deviceId, d.name])), [devices]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 p-4 text-sm text-slate-400">Signed in as {username}</header>
      <main>
        <h1 className="p-4 text-lg font-semibold">All phones</h1>
        <MessageList messages={messages} deviceNames={deviceNames} />
      </main>
    </div>
  );
}

Dashboard.propTypes = {
  username: PropTypes.string.isRequired,
  onLogout: PropTypes.func,
};
