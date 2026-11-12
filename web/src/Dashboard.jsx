import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from './api.js';
import MessageList from './MessageList.jsx';
import Footer from './Footer.jsx';
import AddPhoneDialog from './AddPhoneDialog.jsx';
import ManagePhoneDialog from './ManagePhoneDialog.jsx';
import SettingsDialog from './SettingsDialog.jsx';
import AccountDialog from './AccountDialog.jsx';
import ClearAllDialog from './ClearAllDialog.jsx';
import Sidebar from './Sidebar.jsx';
import Filters from './Filters.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { Button } from './ui.jsx';
import { useStream } from './useStream.js';
import { matchesView } from './matches.js';
import { useE2eKey } from './keyStore.js';
import { readMessage } from './readable.js';
import { useNow } from './useNow.js';

export default function Dashboard({ username, onLogout, pairingTiming }) {
  const [devices, setDevices] = useState([]);
  const [silentAfterMinutes, setSilentAfterMinutes] = useState(0);
  const now = useNow();
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ type: '', app: '', q: '' });
  const [apps, setApps] = useState([]);
  const [unread, setUnread] = useState({});
  const e2eKey = useE2eKey();
  const [nextBefore, setNextBefore] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false); // stop auto-loading until the user retries
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // bump to load the message list again

  const endRef = useRef(null); // sits below the last message; scrolling near it loads more
  const loadingRef = useRef(false);
  const loadOlderRef = useRef(() => {});
  // With an encryption key the server cannot search encrypted text, so search runs here instead
  // and the server is never sent the search words.
  const searchHere = e2eKey !== null;
  const serverFilters = useMemo(() => (searchHere ? { ...filters, q: '' } : filters), [filters, searchHere]);
  const view = useRef({ selected, filters: serverFilters });
  useEffect(() => {
    view.current = { selected, filters: serverFilters };
  });

  const select = useCallback((deviceId) => {
    setSelected(deviceId);
    // Opening a phone reads its messages; All phones shows (so reads) everything.
    setUnread((u) => (deviceId ? { ...u, [deviceId]: 0 } : {}));
  }, []);

  // A phone's messages were cleared (here or on another dashboard): the phone itself stays.
  const clearMessagesOf = useCallback((deviceId) => {
    setMessages((list) => list.filter((m) => m.deviceId !== deviceId));
    setUnread((u) => ({ ...u, [deviceId]: 0 }));
  }, []);

  const clearAllMessages = useCallback(() => {
    setMessages([]);
    setUnread({});
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

  // A heartbeat or a message proves the phone is alive right now.
  const markSeen = useCallback(
    (deviceId, lastSeen) =>
      setDevices((list) => list.map((x) => (x.deviceId === deviceId ? { ...x, lastSeen } : x))),
    [],
  );

  useStream({
    device_seen: (d) => markSeen(d.deviceId, d.lastSeen),
    // The phone's connection opened or closed: the green dot follows it exactly.
    device_presence: (d) =>
      setDevices((list) =>
        list.map((x) => (x.deviceId === d.deviceId ? { ...x, connected: d.connected, lastSeen: d.lastSeen } : x)),
      ),
    message: (m) => {
      markSeen(m.deviceId, new Date().toISOString());
      if (matchesView(m, view.current)) {
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [m, ...list]));
        setApps((known) => (known.includes(m.app) ? known : [...known, m.app].sort()));
      } else if (view.current.selected && m.deviceId !== view.current.selected) {
        setUnread((u) => ({ ...u, [m.deviceId]: (u[m.deviceId] ?? 0) + 1 }));
      }
    },
    device_deleted: (d) => removeDevice(d.deviceId),
    messages_cleared: (d) => clearMessagesOf(d.deviceId),
    messages_cleared_all: clearAllMessages,
    // Merged, not replaced: this event has no `connected`, and a revoked phone is not connected.
    device: (d) =>
      setDevices((list) =>
        list.some((x) => x.deviceId === d.deviceId)
          ? list.map((x) => (x.deviceId === d.deviceId ? { ...x, ...d, ...(d.revokedAt ? { connected: false } : {}) } : x))
          : [d, ...list],
      ),
  });

  useEffect(() => {
    api('/devices')
      .then((d) => {
        setDevices(d.devices);
        setSilentAfterMinutes(d.silentAfterMinutes ?? 0);
      })
      .catch(() => setLoadError('Could not load phones.'));
  }, []);

  useEffect(() => {
    let stale = false;
    const params = new URLSearchParams();
    if (selected) params.set('device', selected);
    for (const [key, value] of Object.entries(serverFilters)) if (value) params.set(key, value);
    api(`/messages?${params}`)
      .then((m) => {
        if (stale) return;
        setLoadError(null);
        setOlderFailed(false);
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
  }, [selected, serverFilters, reloadKey]);

  function queryParams() {
    const params = new URLSearchParams();
    if (selected) params.set('device', selected);
    for (const [key, value] of Object.entries(serverFilters)) if (value) params.set(key, value);
    return params;
  }

  async function loadOlder() {
    if (loadingRef.current || !nextBefore) return; // one page at a time
    loadingRef.current = true;
    setLoadingOlder(true);
    const viewAtStart = JSON.stringify(view.current);
    const params = queryParams();
    params.set('before', nextBefore);
    try {
      const page = await api(`/messages?${params}`);
      // The user changed phone or filters meanwhile: this page belongs to the old list.
      if (JSON.stringify(view.current) !== viewAtStart) return;
      setLoadError(null);
      setOlderFailed(false);
      setMessages((list) => [...list, ...page.messages.filter((m) => !list.some((x) => x.id === m.id))]);
      setNextBefore(page.nextBefore);
    } catch {
      setLoadError('Could not load messages.');
      setOlderFailed(true);
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    loadOlderRef.current = loadOlder;
  });

  // Load the next page when the end of the list scrolls near the screen. Re-created after each
  // page, so a tall window that still shows the end keeps loading. Stops after a failure.
  const canWatchScroll = typeof IntersectionObserver !== 'undefined';
  useEffect(() => {
    if (!nextBefore || olderFailed || !canWatchScroll || !endRef.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlderRef.current();
      },
      { rootMargin: '400px' },
    );
    observer.observe(endRef.current);
    return () => observer.disconnect();
  }, [nextBefore, olderFailed, canWatchScroll]);

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      onLogout();
    }
  }

  // Decrypted for display; the raw (possibly encrypted) messages stay in state.
  const shown = useMemo(() => {
    const readable = messages.map((m) => readMessage(m, e2eKey));
    if (!searchHere || !filters.q) return readable;
    const search = { selected: null, filters: { type: '', app: '', q: filters.q } };
    return readable.filter((m) => matchesView(m, search));
  }, [messages, e2eKey, searchHere, filters.q]);

  const deviceNames = useMemo(() => Object.fromEntries(devices.map((d) => [d.deviceId, d.name])), [devices]);
  const selectedDevice = devices.find((d) => d.deviceId === selected);
  const title = selected ? (deviceNames[selected] ?? 'Phone') : 'All phones';

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">Notiforwarder</span>
        <div className="flex items-center gap-1">
          <span className="hidden text-sm text-muted sm:inline">Signed in as {username}</span>
          <ThemeToggle />
          <Button variant="ghost" onClick={() => setAccountOpen(true)}>
            Account
          </Button>
          <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="md:flex">
        <div className="md:border-r md:border-line">
          <Sidebar
            devices={devices}
            selected={selected}
            unread={unread}
            onSelect={select}
            silentAfterMinutes={silentAfterMinutes}
            now={now}
          />
          <div className="px-3 pb-3">
            <Button onClick={() => setAddOpen(true)} className="w-full">
              Add phone
            </Button>
          </div>
        </div>
        <main className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 px-4 py-4">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {selectedDevice ? (
              <Button variant="secondary" onClick={() => setManageOpen(true)}>
                Manage phone
              </Button>
            ) : (
              !selected && (
                <Button variant="secondary" onClick={() => setClearAllOpen(true)}>
                  Clear all messages
                </Button>
              )
            )}
          </div>
          <Filters filters={filters} apps={apps} onChange={setFilters} />
          {loadError && (
            <p role="alert" className="px-4 pb-3 text-sm text-danger">
              {loadError}
            </p>
          )}
          <MessageList messages={shown} deviceNames={deviceNames} />
          {nextBefore && (
            <div className="p-4 text-center">
              <div ref={endRef} className="h-px" />
              {olderFailed || !canWatchScroll ? (
                <Button variant="secondary" onClick={loadOlder}>
                  {olderFailed ? 'Try again' : 'Load older'}
                </Button>
              ) : (
                loadingOlder && <p className="text-sm text-muted">Loading older messages…</p>
              )}
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
          onCleared={clearMessagesOf}
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
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <ClearAllDialog open={clearAllOpen} onOpenChange={setClearAllOpen} onCleared={clearAllMessages} />
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
