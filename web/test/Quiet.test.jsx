import { render, screen, within, act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './server.js';
import Dashboard from '../src/Dashboard.jsx';
import { device, message, mockApi } from './fixtures.js';
import { FakeEventSource } from './fake-event-source.js';
import { useNow } from '../src/useNow.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

async function open(devices, { silentAfterMinutes, messages = [] } = {}) {
  mockApi({ devices, messages });
  server.use(http.get('/api/v1/devices', () => HttpResponse.json({ devices, silentAfterMinutes })));
  render(<Dashboard username="admin" onLogout={() => {}} />);
  const nav = await screen.findByRole('navigation', { name: /phones/i });
  await within(nav).findByRole('button', { name: /kitchen/i });
  return (name) => within(within(nav).getByRole('button', { name })).getByText(/online|last seen|quiet|never|revoked/i);
}

describe('phones that have gone quiet', () => {
  it('labels a phone not heard from for longer than the threshold, with how long', async () => {
    const status = await open([device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(190) })], { silentAfterMinutes: 120 });

    expect(status(/kitchen/i)).toHaveTextContent('Quiet for 3 h');
  });

  it('shows "Online" for a connected phone, however old its last message is', async () => {
    const status = await open(
      [device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(600), connected: true })],
      { silentAfterMinutes: 120 },
    );

    expect(status(/kitchen/i)).toHaveTextContent('Online');
  });

  it('shows "Last seen" for a phone that checked in recently but is not connected', async () => {
    const status = await open([device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(14) })], { silentAfterMinutes: 120 });

    expect(status(/kitchen/i)).toHaveTextContent(/last seen 14 min ago/i);
  });

  it('uses "Last seen" between online and quiet', async () => {
    const status = await open([device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(45) })], { silentAfterMinutes: 120 });

    expect(status(/kitchen/i)).toHaveTextContent(/last seen 45 min ago/i);
  });

  it('shows no quiet label when the check is off', async () => {
    const status = await open([device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(600) })], { silentAfterMinutes: 0 });

    expect(status(/kitchen/i)).toHaveTextContent(/last seen 10 h ago/i);
  });

  it('clears the label as soon as the phone checks in', async () => {
    const status = await open([device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(190) })], { silentAfterMinutes: 120 });
    expect(status(/kitchen/i)).toHaveTextContent(/quiet/i);

    act(() => FakeEventSource.current.emit('device_seen', { deviceId: 'a', lastSeen: new Date().toISOString() }));

    expect(status(/kitchen/i)).toHaveTextContent(/last seen just now/i);
  });

  it('clears the label when a message arrives from that phone', async () => {
    const status = await open([device({ deviceId: 'a', name: 'Kitchen', lastSeen: minutesAgo(190) })], { silentAfterMinutes: 120 });

    act(() => FakeEventSource.current.emit('message', message({ deviceId: 'a', body: 'hello' })));

    expect(status(/kitchen/i)).toHaveTextContent(/last seen just now/i);
  });
});

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gives the current time and moves it forward on its own', () => {
    const { result } = renderHook(() => useNow(60000));
    const first = result.current;

    act(() => vi.advanceTimersByTime(61000));

    expect(result.current - first).toBeGreaterThanOrEqual(60000);
  });
});
