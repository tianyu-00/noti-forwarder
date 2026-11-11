import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import MessageList from './MessageList.jsx';
import Sidebar from './Sidebar.jsx';

export default function Dashboard({ username }) {
  const [devices, setDevices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api('/devices').then((d) => setDevices(d.devices));
  }, []);

  useEffect(() => {
    let stale = false;
    const params = new URLSearchParams();
    if (selected) params.set('device', selected);
    api(`/messages?${params}`).then((m) => {
      if (!stale) setMessages(m.messages);
    });
    return () => {
      stale = true;
    };
  }, [selected]);

  const deviceNames = useMemo(() => Object.fromEntries(devices.map((d) => [d.deviceId, d.name])), [devices]);
  const title = selected ? (deviceNames[selected] ?? 'Phone') : 'All phones';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 p-4 text-sm text-slate-400">Signed in as {username}</header>
      <div className="md:flex">
        <Sidebar devices={devices} selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1">
          <h1 className="p-4 text-lg font-semibold">{title}</h1>
          <MessageList messages={messages} deviceNames={deviceNames} />
        </main>
      </div>
    </div>
  );
}

Dashboard.propTypes = {
  username: PropTypes.string.isRequired,
  onLogout: PropTypes.func,
};
