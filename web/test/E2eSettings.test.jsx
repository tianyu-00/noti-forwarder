import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './server.js';
import Dashboard from '../src/Dashboard.jsx';
import { device, mockApi } from './fixtures.js';
import { generateKey, isValidKey } from '../src/e2e.js';
import { clearKey, getKey, setKey } from '../src/keyStore.js';
import { withKey } from '../src/pairingPayload.js';

afterEach(() => clearKey());

describe('settings: end-to-end encryption', () => {
  const openSettings = async () => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json({ retentionDays: null })),
      http.get('/api/v1/auth/me', () => HttpResponse.json({ username: 'admin', csrfToken: 'c', totpEnabled: false })),
    );
    mockApi({ devices: [device({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    return { user, section: await within(dialog).findByRole('region', { name: /end-to-end encryption/i }) };
  };

  it('is off by default', async () => {
    const { section } = await openSettings();
    expect(within(section).getByText(/encryption is off/i)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /create key/i })).toBeInTheDocument();
  });

  it('turns on by making a key that stays in this browser, and can show it for another device', async () => {
    const { user, section } = await openSettings();

    await user.click(within(section).getByRole('button', { name: /create key/i }));

    expect(getKey()).not.toBeNull();
    expect(isValidKey(getKey())).toBe(true);
    expect(within(section).getByText(/encryption is on/i)).toBeInTheDocument();
    expect(within(section).queryByText(getKey())).not.toBeInTheDocument(); // hidden until asked
    await user.click(within(section).getByRole('button', { name: /show key/i }));
    expect(within(section).getByText(getKey())).toBeInTheDocument();
  });

  it('takes a key made in another browser, and rejects a bad one', async () => {
    const { user, section } = await openSettings();
    const field = within(section).getByLabelText(/encryption key/i);

    await user.type(field, 'not a key');
    await user.click(within(section).getByRole('button', { name: /use this key/i }));
    expect(within(section).getByRole('alert')).toHaveTextContent(/not a valid/i);
    expect(getKey()).toBeNull();

    await user.clear(field);
    const key = generateKey();
    await user.type(field, key);
    await user.click(within(section).getByRole('button', { name: /use this key/i }));
    expect(getKey()).toBe(key);
    expect(within(section).getByText(/encryption is on/i)).toBeInTheDocument();
  });

  it('asks before forgetting the key, because encrypted messages then cannot be read', async () => {
    setKey(generateKey());
    const { user, section } = await openSettings();

    await user.click(within(section).getByRole('button', { name: /forget key/i }));
    expect(within(section).getByText(/this browser forgets the key/i)).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: /cancel/i }));
    expect(getKey()).not.toBeNull();

    await user.click(within(section).getByRole('button', { name: /forget key/i }));
    await user.click(within(section).getByRole('button', { name: /yes, forget/i }));
    expect(getKey()).toBeNull();
    expect(within(section).getByText(/encryption is off/i)).toBeInTheDocument();
  });
});

describe('add phone with encryption', () => {
  const pairing = () => ({
    code: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    qrPayload: JSON.stringify({ u: 'https://nf.example.com', c: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23' }),
  });
  const openAdd = async () => {
    mockApi({});
    server.use(http.post('/api/v1/pairing-codes', () => HttpResponse.json(pairing(), { status: 201 })));
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /add phone/i }));
    return screen.findByRole('dialog', { name: /add phone/i });
  };

  it('adds the key to the QR payload without changing anything else', () => {
    const key = generateKey();
    expect(JSON.parse(withKey(pairing().qrPayload, key))).toEqual({
      u: 'https://nf.example.com',
      c: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23',
      k: key,
    });
    expect(withKey(pairing().qrPayload, null)).toBe(pairing().qrPayload);
  });

  it('shows the key to type by hand when encryption is on', async () => {
    const key = generateKey();
    setKey(key);
    const dialog = await openAdd();

    expect(await within(dialog).findByText(key)).toBeInTheDocument();
    expect(within(dialog).getByText(/encryption key/i)).toBeInTheDocument();
  });

  it('says the phone will send readable messages when encryption is off', async () => {
    const dialog = await openAdd();

    expect(await within(dialog).findByText(/not be encrypted/i)).toBeInTheDocument();
  });
});
