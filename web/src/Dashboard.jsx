import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import MessageList from './MessageList.jsx';
import Sidebar from './Sidebar.jsx';
import Filters from './Filters.jsx';

export default function Dashboard({ username }) {
  const [devices, setDevices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ type: '', app: '', q: '' });
  const [apps, setApps] = useState([]);

  useEffect(() => {
    api('/devices').then((d) => setDevices(d.devices));
  }, []);

  useEffect(() => {
    let stale = false;
    const params = new URLSearchParams();
    if (selected) params.set('device', selected);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    api(`/messages?${params}`).then((m) => {
      if (stale) return;
      setMessages(m.messages);
      // Accumulate so the app choices do not shrink to the filtered result.
      setApps((known) => [...new Set([...known, ...m.messages.map((x) => x.app)])].sort());
    });
    return () => {
      stale = true;
    };
  }, [selected, filters]);

  const deviceNames = useMemo(() => Object.fromEntries(devices.map((d) => [d.deviceId, d.name])), [devices]);
  const title = selected ? (deviceNames[selected] ?? 'Phone') : 'All phones';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 p-4 text-sm text-slate-400">Signed in as {username}</header>
      <div className="md:flex">
        <Sidebar devices={devices} selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1">
          <h1 className="p-4 text-lg font-semibold">{title}</h1>
          <Filters filters={filters} apps={apps} onChange={setFilters} />
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
