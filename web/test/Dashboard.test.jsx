import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../src/Dashboard.jsx';
import { device, message, mockApi } from './fixtures.js';

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
