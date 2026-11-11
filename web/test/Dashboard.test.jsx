import { render, screen, within } from '@testing-library/react';
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
