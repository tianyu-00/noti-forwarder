import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../src/Dashboard.jsx';
import { device, message, mockApi } from './fixtures.js';
import { FakeEventSource } from './fake-event-source.js';

describe('message list', () => {
  it('shows messages from all phones in the order the server returns them', async () => {
    const phoneA = device({ deviceId: 'a', name: 'Kitchen phone' });
    const phoneB = device({ deviceId: 'b', name: 'Spare phone' });
    mockApi({
      devices: [phoneA, phoneB],
      messages: [
        message({ deviceId: 'b', body: 'newest from B', app: 'com.bank', sender: 'Bank' }),
        message({ deviceId: 'a', body: 'older from A' }),
      ],
    });

    render(<Dashboard username="admin" onLogout={() => {}} />);

    const items = await screen.findAllByRole('article');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('newest from B')).toBeInTheDocument();
    expect(within(items[0]).getByText('Spare phone')).toBeInTheDocument();
    expect(within(items[0]).getByText('Bank')).toBeInTheDocument();
    expect(within(items[1]).getByText('older from A')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /all phones/i })).toBeInTheDocument();
  });

  it('renders message text as plain text, never as HTML', async () => {
    const evil = '<img src=x onerror="alert(1)"> <b>bold</b>';
    mockApi({ devices: [device({ deviceId: 'a' })], messages: [message({ deviceId: 'a', body: evil })] });

    const { container } = render(<Dashboard username="admin" onLogout={() => {}} />);

    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows an empty state when there are no messages', async () => {
    mockApi({ devices: [], messages: [] });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
  });
});

describe('sidebar', () => {
  const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

  it('lists phones with their online status', async () => {
    mockApi({
      devices: [
        device({ deviceId: 'a', name: 'Kitchen phone', lastSeen: minutesAgo(0.5) }),
        device({ deviceId: 'b', name: 'Spare phone', lastSeen: minutesAgo(90) }),
        device({ deviceId: 'c', name: 'Old phone', revokedAt: minutesAgo(5) }),
        device({ deviceId: 'd', name: 'New phone', lastSeen: null }),
      ],
    });
    render(<Dashboard username="admin" onLogout={() => {}} />);

    const nav = await screen.findByRole('navigation', { name: /phones/i });
    expect(within(within(nav).getByRole('button', { name: /kitchen phone/i })).getByText(/online/i)).toBeInTheDocument();
    expect(within(within(nav).getByRole('button', { name: /spare phone/i })).getByText(/last seen/i)).toBeInTheDocument();
    expect(within(within(nav).getByRole('button', { name: /old phone/i })).getByText(/revoked/i)).toBeInTheDocument();
    expect(within(within(nav).getByRole('button', { name: /new phone/i })).getByText(/never connected/i)).toBeInTheDocument();
  });

  it('shows only the selected phone, and All phones shows everything again', async () => {
    const requests = mockApi({
      devices: [device({ deviceId: 'a', name: 'Kitchen phone' }), device({ deviceId: 'b', name: 'Spare phone' })],
      messages: [message({ deviceId: 'a', body: 'hello from a' })],
    });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /spare phone/i }));

    expect(await screen.findByRole('heading', { name: 'Spare phone' })).toBeInTheDocument();
    await waitFor(() => expect(requests.messages.at(-1).get('device')).toBe('b'));

    await user.click(screen.getByRole('button', { name: /all phones/i }));

    expect(await screen.findByRole('heading', { name: /all phones/i })).toBeInTheDocument();
    await waitFor(() => expect(requests.messages.at(-1).get('device')).toBeNull());
  });
});

describe('filters', () => {
  const lastParams = (requests) => requests.messages.at(-1);

  it('filters by type with the All / SMS / Notifications tabs', async () => {
    const requests = mockApi({ devices: [device({ deviceId: 'a' })], messages: [message({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');

    await user.click(screen.getByRole('tab', { name: /^sms$/i }));
    await waitFor(() => expect(lastParams(requests).get('type')).toBe('sms'));

    await user.click(screen.getByRole('tab', { name: /notifications/i }));
    await waitFor(() => expect(lastParams(requests).get('type')).toBe('notification'));

    await user.click(screen.getByRole('tab', { name: /^all$/i }));
    await waitFor(() => expect(lastParams(requests).get('type')).toBeNull());
  });

  it('filters by app, offering the apps seen so far', async () => {
    const requests = mockApi({
      devices: [device({ deviceId: 'a' })],
      messages: [
        message({ deviceId: 'a', app: 'com.bank' }),
        message({ deviceId: 'a', app: 'com.chat' }),
        message({ deviceId: 'a', app: 'com.bank' }),
      ],
    });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');

    const select = screen.getByRole('combobox', { name: /app/i });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All apps',
      'com.bank',
      'com.chat',
    ]);

    await user.selectOptions(select, 'com.chat');
    await waitFor(() => expect(lastParams(requests).get('app')).toBe('com.chat'));
    // The choices must not collapse to the filtered result.
    expect(within(select).getAllByRole('option')).toHaveLength(3);
  });

  it('searches as the user types', async () => {
    const requests = mockApi({ devices: [device({ deviceId: 'a' })], messages: [message({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'parcel');

    await waitFor(() => expect(lastParams(requests).get('q')).toBe('parcel'));
    // Debounced: typing five letters must not fire five requests.
    expect(requests.messages.length).toBeLessThan(5);
  });

  it('keeps the filters when switching phone', async () => {
    const requests = mockApi({
      devices: [device({ deviceId: 'a', name: 'Kitchen phone' })],
      messages: [message({ deviceId: 'a' })],
    });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');

    await user.click(screen.getByRole('tab', { name: /^sms$/i }));
    await user.click(screen.getByRole('button', { name: /kitchen phone/i }));

    await waitFor(() => {
      expect(lastParams(requests).get('device')).toBe('a');
      expect(lastParams(requests).get('type')).toBe('sms');
    });
  });
});

describe('live updates', () => {
  const setup = async (extra = {}) => {
    const devices = [device({ deviceId: 'a', name: 'Kitchen phone' }), device({ deviceId: 'b', name: 'Spare phone' })];
    mockApi({ devices, messages: [message({ deviceId: 'a', body: 'already here' })], ...extra });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');
    return { user, stream: FakeEventSource.current };
  };

  it('listens on the stream endpoint and closes it when unmounted', async () => {
    const { stream } = await setup();
    expect(stream.url).toContain('/api/v1/stream');
  });

  it('closes the stream on unmount', async () => {
    const devices = [device({ deviceId: 'a' })];
    mockApi({ devices, messages: [] });
    const { unmount } = render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText(/no messages yet/i);
    const stream = FakeEventSource.current;
    unmount();
    expect(stream.closed).toBe(true);
  });

  it('puts a pushed message at the top of the list', async () => {
    const { stream } = await setup();

    act(() => stream.emit('message', message({ deviceId: 'b', body: 'brand new' })));

    const items = await screen.findAllByRole('article');
    expect(within(items[0]).getByText('brand new')).toBeInTheDocument();
    expect(items).toHaveLength(2);
  });

  it('ignores a pushed message it already has', async () => {
    const { stream } = await setup();
    const m = message({ deviceId: 'b', body: 'only once' });

    act(() => stream.emit('message', m));
    act(() => stream.emit('message', m));

    expect(await screen.findAllByText('only once')).toHaveLength(1);
  });

  it('does not show a pushed message that fails the current filters', async () => {
    const { stream, user } = await setup();
    await user.click(screen.getByRole('tab', { name: /^sms$/i }));
    await screen.findByRole('tab', { name: /^sms$/i, selected: true });

    act(() => stream.emit('message', message({ deviceId: 'a', type: 'notification', body: 'wrong type' })));
    act(() => stream.emit('message', message({ deviceId: 'a', type: 'sms', app: 'sms', body: 'right type' })));

    expect(await screen.findByText('right type')).toBeInTheDocument();
    expect(screen.queryByText('wrong type')).not.toBeInTheDocument();
  });

  it('counts unread messages per phone and clears them when the phone is opened', async () => {
    const { stream, user } = await setup();
    await user.click(screen.getByRole('button', { name: /kitchen phone/i }));
    await screen.findByRole('heading', { name: 'Kitchen phone' });

    act(() => stream.emit('message', message({ deviceId: 'b', body: 'one' })));
    act(() => stream.emit('message', message({ deviceId: 'b', body: 'two' })));
    act(() => stream.emit('message', message({ deviceId: 'a', body: 'visible, so not unread' })));

    const spare = screen.getByRole('button', { name: /spare phone/i });
    expect(within(spare).getByLabelText('2 unread')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /kitchen phone/i })).queryByLabelText(/unread/)).toBeNull();
    expect(screen.queryByText('one')).not.toBeInTheDocument();

    await user.click(spare);
    await waitFor(() => expect(within(screen.getByRole('button', { name: /spare phone/i })).queryByLabelText(/unread/)).toBeNull());
  });

  it('adds a newly paired phone and applies renames from the stream', async () => {
    const { stream } = await setup();

    act(() => stream.emit('device', device({ deviceId: 'c', name: 'Fresh phone', lastSeen: null })));
    expect(await screen.findByRole('button', { name: /fresh phone/i })).toBeInTheDocument();

    act(() => stream.emit('device', device({ deviceId: 'c', name: 'Renamed phone', lastSeen: null })));
    expect(await screen.findByRole('button', { name: /renamed phone/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fresh phone/i })).not.toBeInTheDocument();
  });
});
