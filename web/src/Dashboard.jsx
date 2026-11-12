import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import MessageList from './MessageList.jsx';
import Footer from './Footer.jsx';
import AddPhoneDialog from './AddPhoneDialog.jsx';
import ManagePhoneDialog from './ManagePhoneDialog.jsx';
import SettingsDialog from './SettingsDialog.jsx';
import Sidebar from './Sidebar.jsx';
import Filters from './Filters.jsx';
import { useStream } from './useStream.js';
import { matchesView } from './matches.js';

export default function Dashboard({ username, onLogout, pairingTiming }) {
  const [devices, setDevices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ type: '', app: '', q: '' });
  const [apps, setApps] = useState([]);
  const [unread, setUnread] = useState({});
  const [nextBefore, setNextBefore] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // bump to load the message list again

  const view = useRef({ selected, filters });
  useEffect(() => {
    view.current = { selected, filters };
  });

  const select = useCallback((deviceId) => {
    setSelected(deviceId);
    // Opening a phone reads its messages; All phones shows (so reads) everything.
    setUnread((u) => (deviceId ? { ...u, [deviceId]: 0 } : {}));
  }, []);

  // A phone was erased (here or on another dashboard): drop it and its messages from view.
  const removeDevice = useCallback((deviceId) => {
    setDevices((list) => list.filter((x) => x.deviceId !== deviceId));
    setMessages((list) => list.filter((m) => m.deviceId !== deviceId));
    setUnread((u) => {
      const rest = { ...u };
      delete rest[deviceId];
      return rest;
    });
    setSelected((current) => (current === deviceId ? null : current));
  }, []);

  useStream({
    message: (m) => {
      if (matchesView(m, view.current)) {
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [m, ...list]));
        setApps((known) => (known.includes(m.app) ? known : [...known, m.app].sort()));
      } else if (view.current.selected && m.deviceId !== view.current.selected) {
        setUnread((u) => ({ ...u, [m.deviceId]: (u[m.deviceId] ?? 0) + 1 }));
      }
    },
    device_deleted: (d) => removeDevice(d.deviceId),
    device: (d) =>
      setDevices((list) =>
        list.some((x) => x.deviceId === d.deviceId)
          ? list.map((x) => (x.deviceId === d.deviceId ? d : x))
          : [d, ...list],
      ),
  });

  useEffect(() => {
    api('/devices')
      .then((d) => setDevices(d.devices))
      .catch(() => setLoadError('Could not load phones.'));
  }, []);

  useEffect(() => {
    let stale = false;
    const params = new URLSearchParams();
    if (selected) params.set('device', selected);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    api(`/messages?${params}`)
      .then((m) => {
        if (stale) return;
        setLoadError(null);
        setMessages(m.messages);
        setNextBefore(m.nextBefore);
        // Accumulate so the app choices do not shrink to the filtered result.
        setApps((known) => [...new Set([...known, ...m.messages.map((x) => x.app)])].sort());
      })
      .catch(() => {
        if (!stale) setLoadError('Could not load messages.');
      });
    return () => {
      stale = true;
    };
  }, [selected, filters, reloadKey]);

  function queryParams() {
    const params = new URLSearchParams();
    if (selected) params.set('device', selected);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return params;
  }

  async function loadOlder() {
    const params = queryParams();
    params.set('before', nextBefore);
    try {
      const page = await api(`/messages?${params}`);
      setMessages((list) => [...list, ...page.messages.filter((m) => !list.some((x) => x.id === m.id))]);
      setNextBefore(page.nextBefore);
    } catch {
      setLoadError('Could not load messages.');
    }
  }

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      onLogout();
    }
  }

  const deviceNames = useMemo(() => Object.fromEntries(devices.map((d) => [d.deviceId, d.name])), [devices]);
  const selectedDevice = devices.find((d) => d.deviceId === selected);
  const title = selected ? (deviceNames[selected] ?? 'Phone') : 'All phones';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-4 text-sm text-slate-400">
        <span>Signed in as {username}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className="rounded px-3 py-1 hover:bg-slate-800">
            Settings
          </button>
          <button type="button" onClick={signOut} className="rounded px-3 py-1 hover:bg-slate-800">
            Sign out
          </button>
        </div>
      </header>
      <div className="md:flex">
        <div>
          <Sidebar devices={devices} selected={selected} unread={unread} onSelect={select} />
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium hover:bg-sky-500"
            >
              Add phone
            </button>
          </div>
        </div>
        <main className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 p-4">
            <h1 className="text-lg font-semibold">{title}</h1>
            {selectedDevice && (
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
              >
                Manage phone
              </button>
            )}
          </div>
          <Filters filters={filters} apps={apps} onChange={setFilters} />
          {loadError && (
            <p role="alert" className="px-4 pb-2 text-sm text-red-400">
              {loadError}
            </p>
          )}
          <MessageList messages={messages} deviceNames={deviceNames} />
          {nextBefore && (
            <div className="p-4">
              <button type="button" onClick={loadOlder} className="rounded bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
                Load older
              </button>
            </div>
          )}
        </main>
      </div>
      {selectedDevice && (
        <ManagePhoneDialog
          device={selectedDevice}
          open={manageOpen}
          onOpenChange={setManageOpen}
          onRenamed={(d) => setDevices((list) => list.map((x) => (x.deviceId === d.deviceId ? d : x)))}
          onErased={removeDevice}
          onRevoked={(id) =>
            setDevices((list) =>
              list.map((x) => (x.deviceId === id ? { ...x, revokedAt: new Date().toISOString() } : x)),
            )
          }
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onPurged={() => setReloadKey((k) => k + 1)}
      />
      <AddPhoneDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        devices={devices}
        onDevicesLoaded={setDevices}
        timing={pairingTiming}
      />
      <Footer />
    </div>
  );
}

Dashboard.propTypes = {
  username: PropTypes.string.isRequired,
  onLogout: PropTypes.func,
  // Seam for tests: how often to check for the new phone and how long to show the confirmation.
  pairingTiming: PropTypes.shape({ pollMs: PropTypes.number, closeMs: PropTypes.number }),
};
