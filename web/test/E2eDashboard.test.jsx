import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../src/Dashboard.jsx';
import { device, message, mockApi } from './fixtures.js';
import { FakeEventSource } from './fake-event-source.js';
import { generateKey } from '../src/e2e.js';
import { clearKey, setKey } from '../src/keyStore.js';
import { encryptField } from './e2e-helpers.js';

const KEY = generateKey();
afterEach(() => clearKey());

// A message as the server stores it when the phone encrypted it.
const encrypted = (overrides, key = KEY) => {
  const plain = message(overrides);
  return { ...plain, sender: encryptField(key, 'sender', plain.sender), body: encryptField(key, 'body', plain.body) };
};

const open = async (messages) => {
  const requests = mockApi({ devices: [device({ deviceId: 'a', name: 'Kitchen' })], messages });
  render(<Dashboard username="admin" onLogout={() => {}} />);
  await screen.findAllByRole('article');
  return requests;
};

describe('end-to-end encrypted messages in the dashboard', () => {
  it('shows them decrypted, with the 2FA code highlighted and a copy button', async () => {
    setKey(KEY);
    await open([encrypted({ deviceId: 'a', sender: 'Bank', body: 'Your code is 482913, do not share it' })]);

    const article = screen.getByRole('article');
    expect(within(article).getByText('Bank')).toBeInTheDocument();
    expect(within(article).getByText('482913').tagName).toBe('MARK');
    expect(within(article).getByRole('button', { name: /copy code/i })).toBeInTheDocument();
    expect(article).not.toHaveTextContent('e2e:v1');
  });

  it('says it is encrypted, and shows no scrambled text, when this browser has no key', async () => {
    await open([encrypted({ deviceId: 'a', body: 'secret words' })]);

    const article = screen.getByRole('article');
    expect(article).toHaveTextContent(/encrypted message/i);
    expect(article).toHaveTextContent(/key in settings/i);
    expect(article).not.toHaveTextContent('e2e:v1');
    expect(article).not.toHaveTextContent('secret words');
  });

  it('says so when the key is a different one', async () => {
    setKey(generateKey());
    await open([encrypted({ deviceId: 'a', body: 'secret words' })]);

    expect(screen.getByRole('article')).toHaveTextContent(/could not decrypt/i);
    expect(screen.getByRole('article')).not.toHaveTextContent('e2e:v1');
  });

  it('still shows ordinary messages from phones that do not encrypt', async () => {
    setKey(KEY);
    await open([message({ deviceId: 'a', sender: 'Old phone', body: 'plain hello' })]);

    expect(screen.getByText('plain hello')).toBeInTheDocument();
  });

  it('decrypts a message that arrives live', async () => {
    setKey(KEY);
    await open([message({ deviceId: 'a', body: 'first' })]);

    act(() => FakeEventSource.current.emit('message', encrypted({ deviceId: 'a', sender: 'Courier', body: 'Parcel on its way' })));

    expect(await screen.findByText('Parcel on its way')).toBeInTheDocument();
    expect(screen.getByText('Courier')).toBeInTheDocument();
  });

  it('searches inside the browser, because the server cannot read encrypted text', async () => {
    setKey(KEY);
    const requests = await open([
      encrypted({ deviceId: 'a', body: 'Your parcel has shipped' }),
      encrypted({ deviceId: 'a', body: 'Your bank balance is low' }),
    ]);
    const user = userEvent.setup();

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'parcel');

    await waitFor(() => expect(screen.queryByText('Your bank balance is low')).not.toBeInTheDocument());
    expect(screen.getByText('Your parcel has shipped')).toBeInTheDocument();
    expect(requests.messages.every((p) => !p.has('q'))).toBe(true);
  });
});
