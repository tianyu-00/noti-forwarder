import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './server.js';
import Dashboard from '../src/Dashboard.jsx';
import { device, message, mockApi } from './fixtures.js';
import { FakeEventSource } from './fake-event-source.js';
import { FakeIntersectionObserver } from './fake-intersection-observer.js';

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

describe('2FA codes', () => {
  const setup = async (msg) => {
    mockApi({ devices: [device({ deviceId: 'a' })], messages: [msg] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');
    return user;
  };

  it('highlights the code inside the message text', async () => {
    await setup(message({ deviceId: 'a', body: 'Your code is 482913, do not share it', code: '482913' }));

    const mark = screen.getByText('482913');
    expect(mark.tagName).toBe('MARK');
    expect(screen.getByRole('article')).toHaveTextContent('Your code is 482913, do not share it');
  });

  it('copies the code to the clipboard and says so', async () => {
    const user = await setup(message({ deviceId: 'a', body: 'Code: 123 456', code: '123456' }));

    await user.click(screen.getByRole('button', { name: /copy code/i }));

    expect(await navigator.clipboard.readText()).toBe('123456'); // digits only, no space
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('says when the browser would not let it copy', async () => {
    const user = await setup(message({ deviceId: 'a', body: 'Your code is 482913', code: '482913' }));
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    await user.click(screen.getByRole('button', { name: /copy code/i }));

    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });

  describe('on a page without HTTPS (no clipboard API)', () => {
    let copied;
    beforeEach(() => {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      copied = [];
    });
    afterEach(() => {
      delete window.isSecureContext;
      delete document.execCommand;
    });

    it('still copies the code, through a temporary text field', async () => {
      document.execCommand = vi.fn(() => {
        copied.push(document.querySelector('textarea')?.value);
        return true;
      });
      const user = await setup(message({ deviceId: 'a', body: 'Your code is 482913', code: '482913' }));

      await user.click(screen.getByRole('button', { name: /copy code/i }));

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(copied).toEqual(['482913']);
      expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
      expect(document.querySelector('textarea')).toBeNull(); // the temporary field is removed
    });

    it('says so when the browser refuses that too', async () => {
      document.execCommand = vi.fn(() => false);
      const user = await setup(message({ deviceId: 'a', body: 'Your code is 482913', code: '482913' }));

      await user.click(screen.getByRole('button', { name: /copy code/i }));

      expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
    });
  });

  it('shows no copy button when a message has no code', async () => {
    await setup(message({ deviceId: 'a', body: 'Your parcel has shipped', code: null }));

    expect(screen.queryByRole('button', { name: /copy code/i })).not.toBeInTheDocument();
    expect(document.querySelector('mark')).toBeNull();
  });

  it('keeps hostile text harmless while highlighting the code', async () => {
    const evil = '<img src=x onerror="alert(1)"> code 123456 <b>bold</b>';
    await setup(message({ deviceId: 'a', body: evil, code: '123456' }));

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('123456').tagName).toBe('MARK');
    expect(screen.getByRole('article')).toHaveTextContent(evil);
  });

  it('highlights a code that arrives live too', async () => {
    mockApi({ devices: [device({ deviceId: 'a' })], messages: [message({ deviceId: 'a', body: 'older' })] });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findAllByRole('article');

    act(() => FakeEventSource.current.emit('message', message({ deviceId: 'a', body: 'Use 771155 to sign in', code: '771155' })));

    expect((await screen.findByText('771155')).tagName).toBe('MARK');
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
    // The sidebar exists straight away, empty; wait for the phones themselves to load.
    await within(nav).findByRole('button', { name: /kitchen phone/i });
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

describe('older messages load as you scroll', () => {
  const pages = {
    first: { messages: [message({ deviceId: 'a', body: 'page one' })], nextBefore: 'cursor-1' },
    second: { messages: [message({ deviceId: 'a', body: 'page two' })], nextBefore: 'cursor-2' },
    third: { messages: [message({ deviceId: 'a', body: 'page three' })], nextBefore: null },
  };
  const byCursor = (params) =>
    ({ 'cursor-1': pages.second, 'cursor-2': pages.third })[params.get('before')] ?? pages.first;

  const open = async () => {
    const requests = mockApi({ devices: [device({ deviceId: 'a' })], messagesResponse: byCursor });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('page one');
    return requests;
  };
  const reachEnd = () => act(() => FakeIntersectionObserver.current.trigger(true));
  const olderRequests = (requests) => requests.messages.filter((p) => p.get('before'));

  it('loads the next page, using the server cursor, when the end of the list comes into view', async () => {
    const requests = await open();
    expect(olderRequests(requests)).toHaveLength(0); // nothing extra until the user scrolls

    reachEnd();

    expect(await screen.findByText('page two')).toBeInTheDocument();
    expect(screen.getByText('page one')).toBeInTheDocument();
    expect(olderRequests(requests).map((p) => p.get('before'))).toEqual(['cursor-1']);
  });

  it('asks for one page at a time while a page is still loading', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let olderCalls = 0;
    server.use(
      http.get('/api/v1/messages', async ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        if (!before) return HttpResponse.json(pages.first);
        olderCalls += 1;
        await gate;
        return HttpResponse.json(pages.second);
      }),
      http.get('/api/v1/devices', () => HttpResponse.json({ devices: [device({ deviceId: 'a' })] })),
    );
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('page one');

    reachEnd();
    reachEnd();
    reachEnd();
    release();

    expect(await screen.findByText('page two')).toBeInTheDocument();
    expect(olderCalls).toBe(1);
  });

  it('keeps loading while the end of the list is still on screen, until there are no more', async () => {
    FakeIntersectionObserver.startVisible = true; // a tall window: the end never leaves the screen
    await open();

    expect(await screen.findByText('page three')).toBeInTheDocument();
    expect(screen.getByText('page one')).toBeInTheDocument();
    expect(screen.getByText('page two')).toBeInTheDocument();
  });

  it('stops watching the end of the list once there is nothing older', async () => {
    FakeIntersectionObserver.startVisible = true;
    const requests = await open();
    await screen.findByText('page three');
    const before = requests.messages.length;

    await waitFor(() => expect(FakeIntersectionObserver.active).toHaveLength(0));
    expect(requests.messages).toHaveLength(before);
  });

  it('shows an error with a Try again button when a page fails, and does not retry by itself', async () => {
    let failing = true;
    let olderCalls = 0;
    server.use(
      http.get('/api/v1/messages', ({ request }) => {
        if (!new URL(request.url).searchParams.get('before')) return HttpResponse.json(pages.first);
        olderCalls += 1;
        return failing ? HttpResponse.json({ error: 'x' }, { status: 500 }) : HttpResponse.json(pages.third);
      }),
      http.get('/api/v1/devices', () => HttpResponse.json({ devices: [device({ deviceId: 'a' })] })),
    );
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('page one');

    reachEnd();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    expect(olderCalls).toBe(1);

    failing = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('page three')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops an older page that arrives after the user switched filters', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/messages', async ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('before')) {
          await gate;
          return HttpResponse.json({ messages: [message({ deviceId: 'a', body: 'stale page' })], nextBefore: null });
        }
        return HttpResponse.json(
          params.get('type') === 'sms'
            ? { messages: [message({ deviceId: 'a', type: 'sms', body: 'only texts' })], nextBefore: null }
            : pages.first,
        );
      }),
      http.get('/api/v1/devices', () => HttpResponse.json({ devices: [device({ deviceId: 'a' })] })),
    );
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('page one');

    reachEnd(); // an older page starts loading...
    await user.click(screen.getByRole('tab', { name: 'SMS' })); // ...then the user changes the view
    expect(await screen.findByText('only texts')).toBeInTheDocument();
    release();
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText('stale page')).not.toBeInTheDocument();
    expect(screen.getByText('only texts')).toBeInTheDocument();
  });

  it('falls back to a Load older button when the browser cannot watch scrolling', async () => {
    delete globalThis.IntersectionObserver;
    const user = userEvent.setup();
    mockApi({ devices: [device({ deviceId: 'a' })], messagesResponse: byCursor });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('page one');

    await user.click(screen.getByRole('button', { name: /load older/i }));

    expect(await screen.findByText('page two')).toBeInTheDocument();
    globalThis.IntersectionObserver = FakeIntersectionObserver;
  });
});

describe('errors', () => {
  it('tells the user when messages cannot be loaded', async () => {
    server.use(
      http.get('/api/v1/devices', () => HttpResponse.json({ devices: [] })),
      http.get('/api/v1/messages', () => HttpResponse.json({ error: 'internal_error' }, { status: 500 })),
    );
    render(<Dashboard username="admin" onLogout={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load messages/i);
  });
});

describe('footer and sign out', () => {
  it('shows the server version in the footer', async () => {
    mockApi({});
    server.use(
      http.get('/api/v1/health', () => HttpResponse.json({ version: '1.2.3', commit: 'abc1234', buildTime: 'now' })),
    );
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('contentinfo')).toHaveTextContent(/server 1\.2\.3 \(abc1234\)/i),
    );
  });

  it('signs out through the API and tells the app', async () => {
    mockApi({});
    let called = false;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onLogout = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={onLogout} />);

    await user.click(await screen.findByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(onLogout).toHaveBeenCalled());
    expect(called).toBe(true);
  });
});

describe('add phone', () => {
  const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
  const pairingResponse = (overrides = {}) => ({
    code: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23',
    expiresAt: inMinutes(10),
    qrPayload: JSON.stringify({ u: 'https://nf.example.com', c: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23' }),
    ...overrides,
  });

  it('shows a QR code and a typeable key for a fresh pairing code', async () => {
    mockApi({});
    let posts = 0;
    server.use(
      http.post('/api/v1/pairing-codes', () => {
        posts += 1;
        return HttpResponse.json(pairingResponse(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /add phone/i }));

    const dialog = await screen.findByRole('dialog', { name: /add phone/i });
    expect(await within(dialog).findByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /pairing qr code/i })).toBeInTheDocument();
    expect(within(dialog).getByText('https://nf.example.com')).toBeInTheDocument();
    expect(within(dialog).getByText(/expires in 9:5\d|expires in 10:00/i)).toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it('offers a new code once the old one has expired', async () => {
    mockApi({});
    let posts = 0;
    server.use(
      http.post('/api/v1/pairing-codes', () => {
        posts += 1;
        return HttpResponse.json(posts === 1 ? pairingResponse({ expiresAt: inMinutes(-1) }) : pairingResponse(), {
          status: 201,
        });
      }),
    );
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /add phone/i }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/this code has expired/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('img', { name: /pairing qr code/i })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /new code/i }));

    expect(await within(dialog).findByRole('img', { name: /pairing qr code/i })).toBeInTheDocument();
    expect(posts).toBe(2);
  });

  it('shows an error when the code cannot be created', async () => {
    mockApi({});
    server.use(http.post('/api/v1/pairing-codes', () => HttpResponse.json({ error: 'csrf' }, { status: 403 })));
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /add phone/i }));

    expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toHaveTextContent(/could not create/i);
  });

  it('confirms live when the new phone connects', async () => {
    mockApi({ devices: [device({ deviceId: 'a', name: 'Kitchen phone' })] });
    server.use(http.post('/api/v1/pairing-codes', () => HttpResponse.json(pairingResponse(), { status: 201 })));
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /add phone/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: /pairing qr code/i });

    act(() => FakeEventSource.current.emit('device', device({ deviceId: 'new', name: 'Fresh phone', lastSeen: null })));

    expect(await within(dialog).findByText(/fresh phone connected/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('img', { name: /pairing qr code/i })).not.toBeInTheDocument();
  });
});

describe('manage a phone', () => {
  const openManage = async (user) => {
    await user.click(await screen.findByRole('button', { name: /kitchen phone/i }));
    await user.click(await screen.findByRole('button', { name: /manage phone/i }));
    return screen.findByRole('dialog', { name: /kitchen phone/i });
  };
  const setup = () => {
    mockApi({ devices: [device({ deviceId: 'a', name: 'Kitchen phone' })] });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    return userEvent.setup();
  };

  it('only offers management when a single phone is selected', async () => {
    const user = setup();
    await screen.findByRole('button', { name: /kitchen phone/i });
    expect(screen.queryByRole('button', { name: /manage phone/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /kitchen phone/i }));
    expect(await screen.findByRole('button', { name: /manage phone/i })).toBeInTheDocument();
  });

  it('renames the phone', async () => {
    let sent;
    server.use(
      http.patch('/api/v1/devices/a', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(device({ deviceId: 'a', name: sent.name }));
      }),
    );
    const user = setup();
    const dialog = await openManage(user);

    const input = within(dialog).getByLabelText(/name/i);
    await user.clear(input);
    await user.type(input, 'Hall phone');
    await user.click(within(dialog).getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('heading', { name: 'Hall phone' })).toBeInTheDocument();
    expect(sent).toEqual({ name: 'Hall phone' });
    expect(screen.getByRole('button', { name: /hall phone/i })).toBeInTheDocument();
  });

  it('shows an error when renaming fails', async () => {
    server.use(http.patch('/api/v1/devices/a', () => HttpResponse.json({ error: 'x' }, { status: 500 })));
    const user = setup();
    const dialog = await openManage(user);

    await user.click(within(dialog).getByRole('button', { name: /save/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not rename/i);
  });

  it('asks for confirmation before revoking, then revokes', async () => {
    let deletes = 0;
    server.use(
      http.delete('/api/v1/devices/a', () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = setup();
    const dialog = await openManage(user);

    await user.click(within(dialog).getByRole('button', { name: /revoke this phone/i }));
    expect(deletes).toBe(0);
    expect(within(dialog).getByText(/must be paired again/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /yes, revoke/i }));

    await waitFor(() => expect(deletes).toBe(1));
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
  });

  it('keeps the phone when the revoke confirmation is cancelled', async () => {
    let deletes = 0;
    server.use(
      http.delete('/api/v1/devices/a', () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = setup();
    const dialog = await openManage(user);

    await user.click(within(dialog).getByRole('button', { name: /revoke this phone/i }));
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(within(dialog).getByRole('button', { name: /revoke this phone/i })).toBeInTheDocument();
    expect(deletes).toBe(0);
  });
});

describe('erasing a revoked phone', () => {
  const revokedAt = new Date(Date.now() - 60000).toISOString();
  const open = async (user) => {
    await user.click(await screen.findByRole('button', { name: /old phone/i }));
    await user.click(await screen.findByRole('button', { name: /manage phone/i }));
    return screen.findByRole('dialog', { name: /old phone/i });
  };

  it('does not offer erasing for a phone that is still active', async () => {
    mockApi({ devices: [device({ deviceId: 'a', name: 'Old phone' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    const dialog = await open(user);
    expect(within(dialog).queryByRole('button', { name: /erase/i })).not.toBeInTheDocument();
  });

  it('asks for confirmation, then removes the phone and its messages and goes back to all phones', async () => {
    let erased = 0;
    server.use(
      http.delete('/api/v1/devices/a/permanent', () => {
        erased += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mockApi({
      devices: [device({ deviceId: 'a', name: 'Old phone', revokedAt }), device({ deviceId: 'b', name: 'Spare phone' })],
      // Like the real server: once erased, its messages are gone from every later load.
      messagesResponse: () => ({
        messages: erased ? [] : [message({ deviceId: 'a', body: 'from the old phone' })],
        nextBefore: null,
      }),
    });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    const dialog = await open(user);

    await user.click(within(dialog).getByRole('button', { name: /erase this phone/i }));
    expect(erased).toBe(0);
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /yes, erase/i }));

    await waitFor(() => expect(erased).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: /old phone/i })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /all phones/i })).toBeInTheDocument();
    expect(screen.queryByText('from the old phone')).not.toBeInTheDocument();
  });

  it('removes a phone another dashboard erased', async () => {
    mockApi({ devices: [device({ deviceId: 'a', name: 'Old phone' })] });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByRole('button', { name: /old phone/i });

    act(() => FakeEventSource.current.emit('device_deleted', { deviceId: 'a' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /old phone/i })).not.toBeInTheDocument());
  });
});

describe('settings: message retention', () => {
  const setup = async (retentionDays = null) => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json({ retentionDays })),
      http.get('/api/v1/auth/me', () => HttpResponse.json({ username: 'admin', csrfToken: 'c', totpEnabled: false })),
    );
    mockApi({ devices: [device({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /settings/i }));
    return { user, dialog: await screen.findByRole('dialog', { name: /settings/i }) };
  };

  it('shows that messages are kept forever by default', async () => {
    const { dialog } = await setup(null);
    expect(await within(dialog).findByRole('radio', { name: /keep messages forever/i })).toBeChecked();
  });

  it('shows the saved limit', async () => {
    const { dialog } = await setup(45);
    expect(await within(dialog).findByRole('radio', { name: /delete messages older than/i })).toBeChecked();
    expect(within(dialog).getByRole('spinbutton', { name: /days/i })).toHaveValue(45);
  });

  it('confirms before saving a limit, then saves it and says how many were deleted', async () => {
    let sent;
    server.use(
      http.put('/api/v1/settings', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ retentionDays: 30, purged: 12 });
      }),
    );
    const { user, dialog } = await setup(null);
    await user.click(await within(dialog).findByRole('radio', { name: /delete messages older than/i }));
    const days = within(dialog).getByRole('spinbutton', { name: /days/i });
    await user.clear(days);
    await user.type(days, '30');

    await user.click(within(dialog).getByRole('button', { name: /^save/i }));
    expect(sent).toBeUndefined();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /yes, save/i }));

    await waitFor(() => expect(sent).toEqual({ retentionDays: 30 }));
    expect(await within(dialog).findByText(/deleted 12 old messages/i)).toBeInTheDocument();
  });

  it('saves keep-forever without a warning', async () => {
    let sent;
    server.use(
      http.put('/api/v1/settings', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ retentionDays: null, purged: 0 });
      }),
    );
    const { user, dialog } = await setup(30);
    await user.click(await within(dialog).findByRole('radio', { name: /keep messages forever/i }));
    await user.click(within(dialog).getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(sent).toEqual({ retentionDays: null }));
  });

  it('does not allow a limit that is not a whole number of days from 1 to 3650', async () => {
    const { user, dialog } = await setup(null);
    await user.click(await within(dialog).findByRole('radio', { name: /delete messages older than/i }));
    const days = within(dialog).getByRole('spinbutton', { name: /days/i });
    await user.clear(days);
    await user.type(days, '0');
    await user.click(within(dialog).getByRole('button', { name: /^save/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/1 and 3650/i);
  });

  it('shows an error when saving fails', async () => {
    server.use(http.put('/api/v1/settings', () => HttpResponse.json({ error: 'x' }, { status: 500 })));
    const { user, dialog } = await setup(30);
    await user.click(await within(dialog).findByRole('radio', { name: /keep messages forever/i }));
    await user.click(within(dialog).getByRole('button', { name: /^save/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not save/i);
  });
});

describe('account: two-step login', () => {
  const setup = async ({ totpEnabled }) => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json({ retentionDays: null })),
      http.get('/api/v1/auth/me', () => HttpResponse.json({ username: 'admin', csrfToken: 'c', totpEnabled })),
    );
    mockApi({ devices: [device({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /account/i }));
    return { user, dialog: await screen.findByRole('dialog', { name: /account/i }) };
  };

  it('says whether two-step login is on or off', async () => {
    const off = await setup({ totpEnabled: false });
    expect(await within(off.dialog).findByText(/two-step login is off/i)).toBeInTheDocument();
    expect(within(off.dialog).getByRole('button', { name: /turn on/i })).toBeInTheDocument();
  });

  it('turns on: shows a QR code and the key, checks a code, then shows the backup codes', async () => {
    let enabledWith;
    const codes = Array.from({ length: 10 }, (_, i) => `code${i}-abcde`);
    server.use(
      http.post('/api/v1/auth/totp/setup', () =>
        HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/N:admin?secret=JBSWY3DPEHPK3PXP' }),
      ),
      http.post('/api/v1/auth/totp/enable', async ({ request }) => {
        enabledWith = await request.json();
        return HttpResponse.json({ backupCodes: codes });
      }),
    );
    const { user, dialog } = await setup({ totpEnabled: false });

    await user.click(await within(dialog).findByRole('button', { name: /turn on/i }));
    expect(await within(dialog).findByRole('img', { name: /authenticator qr code/i })).toBeInTheDocument();
    expect(within(dialog).getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/6-digit code/i), '123456');
    await user.click(within(dialog).getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(enabledWith).toEqual({ code: '123456' }));
    expect(await within(dialog).findByText(/save these backup codes/i)).toBeInTheDocument();
    for (const c of codes) expect(within(dialog).getByText(c)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /i have saved them/i }));
    expect(await within(dialog).findByText(/two-step login is on/i)).toBeInTheDocument();
  });

  it('says when the code was wrong and lets the user try again', async () => {
    server.use(
      http.post('/api/v1/auth/totp/setup', () => HttpResponse.json({ secret: 'ABCDEFGH', otpauthUri: 'otpauth://totp/x' })),
      http.post('/api/v1/auth/totp/enable', () => HttpResponse.json({ error: 'invalid_code' }, { status: 400 })),
    );
    const { user, dialog } = await setup({ totpEnabled: false });
    await user.click(await within(dialog).findByRole('button', { name: /turn on/i }));
    await user.type(await within(dialog).findByLabelText(/6-digit code/i), '000000');
    await user.click(within(dialog).getByRole('button', { name: /confirm/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/code was not correct/i);
    expect(within(dialog).getByLabelText(/6-digit code/i)).toBeInTheDocument();
  });

  it('turns off with the password and a code', async () => {
    let sent;
    server.use(
      http.post('/api/v1/auth/totp/disable', async ({ request }) => {
        sent = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, dialog } = await setup({ totpEnabled: true });
    expect(await within(dialog).findByText(/two-step login is on/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /turn off/i }));
    await user.type(within(dialog).getByLabelText(/^password/i), 'my password');
    await user.type(within(dialog).getByLabelText(/code/i), '654321');
    await user.click(within(dialog).getByRole('button', { name: /confirm turn off/i }));

    await waitFor(() => expect(sent).toEqual({ password: 'my password', code: '654321' }));
    expect(await within(dialog).findByText(/two-step login is off/i)).toBeInTheDocument();
  });

  it('shows an error and stays on when turning off is refused', async () => {
    server.use(http.post('/api/v1/auth/totp/disable', () => HttpResponse.json({ error: 'invalid_credentials' }, { status: 403 })));
    const { user, dialog } = await setup({ totpEnabled: true });
    await user.click(await within(dialog).findByRole('button', { name: /turn off/i }));
    await user.type(within(dialog).getByLabelText(/^password/i), 'nope');
    await user.type(within(dialog).getByLabelText(/code/i), '000000');
    await user.click(within(dialog).getByRole('button', { name: /confirm turn off/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/password or code was not correct/i);
    expect(within(dialog).queryByText(/two-step login is off/i)).not.toBeInTheDocument();
  });
});

describe('clearing a phone\'s messages', () => {
  const setup = async (messages) => {
    mockApi({ devices: [device({ deviceId: 'a', name: 'Kitchen phone' }), device({ deviceId: 'b', name: 'Spare phone' })], messages });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /kitchen phone/i }));
    await user.click(await screen.findByRole('button', { name: /manage phone/i }));
    return { user, dialog: await screen.findByRole('dialog', { name: /kitchen phone/i }) };
  };
  const both = [
    message({ deviceId: 'a', body: 'from the kitchen' }),
    message({ deviceId: 'b', body: 'from the spare' }),
  ];

  it('is offered for a phone that is still active, without revoking it', async () => {
    const { dialog } = await setup(both);
    expect(within(dialog).getByRole('button', { name: /clear messages/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /revoke this phone/i })).toBeInTheDocument();
  });

  it('asks first, then deletes the messages and keeps the phone', async () => {
    let cleared = 0;
    server.use(
      http.delete('/api/v1/devices/a/messages', () => {
        cleared += 1;
        return HttpResponse.json({ deleted: 1 });
      }),
    );
    const { user, dialog } = await setup([message({ deviceId: 'a', body: 'from the kitchen' })]);

    await user.click(within(dialog).getByRole('button', { name: /clear messages/i }));
    expect(cleared).toBe(0);
    expect(within(dialog).getByText(/phone stays paired/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /yes, clear/i }));

    await waitFor(() => expect(cleared).toBe(1));
    await waitFor(() => expect(screen.queryByText('from the kitchen')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /kitchen phone/i })).toBeInTheDocument();
    expect(screen.queryByText('Revoked')).not.toBeInTheDocument();
  });

  it('keeps the messages when the confirmation is cancelled', async () => {
    let cleared = 0;
    server.use(
      http.delete('/api/v1/devices/a/messages', () => {
        cleared += 1;
        return HttpResponse.json({ deleted: 1 });
      }),
    );
    const { user, dialog } = await setup([message({ deviceId: 'a', body: 'from the kitchen' })]);

    await user.click(within(dialog).getByRole('button', { name: /clear messages/i }));
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(cleared).toBe(0);
    expect(within(dialog).getByRole('button', { name: /clear messages/i })).toBeInTheDocument();
  });

  it('shows an error and keeps the messages when clearing fails', async () => {
    server.use(http.delete('/api/v1/devices/a/messages', () => HttpResponse.json({ error: 'x' }, { status: 500 })));
    const { user, dialog } = await setup([message({ deviceId: 'a', body: 'from the kitchen' })]);

    await user.click(within(dialog).getByRole('button', { name: /clear messages/i }));
    await user.click(within(dialog).getByRole('button', { name: /yes, clear/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not clear/i);
    expect(screen.getByText('from the kitchen')).toBeInTheDocument();
  });

  it('drops a phone\'s messages when another dashboard clears them', async () => {
    mockApi({ devices: [device({ deviceId: 'a' }), device({ deviceId: 'b' })], messages: both });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('from the kitchen');

    act(() => FakeEventSource.current.emit('messages_cleared', { deviceId: 'a' }));

    await waitFor(() => expect(screen.queryByText('from the kitchen')).not.toBeInTheDocument());
    expect(screen.getByText('from the spare')).toBeInTheDocument();
  });
});

describe('add phone: scan feedback', () => {
  const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
  const timing = { pollMs: 40, closeMs: 120 };
  const pairing = {
    code: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23',
    expiresAt: inMinutes(10),
    qrPayload: JSON.stringify({ u: 'https://nf.example.com', c: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23' }),
  };

  // The phone list a new pairing adds to; the stream is deliberately silent here.
  function setup() {
    const kitchen = device({ deviceId: 'a', name: 'Kitchen phone' });
    let devices = [kitchen];
    mockApi({ devices });
    server.use(
      http.get('/api/v1/devices', () => HttpResponse.json({ devices })),
      http.post('/api/v1/pairing-codes', () => HttpResponse.json(pairing, { status: 201 })),
    );
    render(<Dashboard username="admin" onLogout={() => {}} pairingTiming={timing} />);
    return {
      pairNewPhone: () => {
        devices = [device({ deviceId: 'new', name: 'Fresh phone', lastSeen: null }), kitchen];
      },
    };
  }

  it('says it is waiting for the phone while the QR code is shown', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add phone/i }));

    expect(await within(await screen.findByRole('dialog')).findByText(/waiting for the phone/i)).toBeInTheDocument();
  });

  it('notices the new phone by itself, confirms it and closes the dialog', async () => {
    const { pairNewPhone } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add phone/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: /pairing qr code/i });

    pairNewPhone(); // the phone scans; no stream event arrives

    expect(await within(dialog).findByText(/fresh phone connected/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('img', { name: /pairing qr code/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /fresh phone/i })).toBeInTheDocument();
  });

  it('stops checking once the dialog is closed', async () => {
    setup();
    let polls = 0;
    server.use(
      http.get('/api/v1/devices', () => {
        polls += 1;
        return HttpResponse.json({ devices: [] });
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add phone/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/waiting for the phone/i);
    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const after = polls;
    await new Promise((r) => setTimeout(r, 200));
    expect(polls).toBe(after);
  });

  // A phone that is already listed pairs again: its id is not new, only its pairedAt moves.
  function setupKnownPhone() {
    const createdAt = new Date().toISOString();
    const kitchen = device({ deviceId: 'a', name: 'Kitchen phone', pairedAt: '2026-11-01T10:00:00.000Z' });
    let devices = [kitchen];
    mockApi({ devices });
    server.use(
      http.get('/api/v1/devices', () => HttpResponse.json({ devices })),
      http.post('/api/v1/pairing-codes', () => HttpResponse.json({ ...pairing, createdAt }, { status: 201 })),
    );
    render(<Dashboard username="admin" onLogout={() => {}} pairingTiming={timing} />);
    return {
      pairAgain: () => {
        devices = [{ ...kitchen, pairedAt: new Date(Date.now() + 1000).toISOString() }];
      },
    };
  }

  it('notices a phone that was already on the list pairing again', async () => {
    const { pairAgain } = setupKnownPhone();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add phone/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: /pairing qr code/i });

    pairAgain();

    expect(await within(dialog).findByText(/kitchen phone connected/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps waiting while the listed phones were paired before this code was made', async () => {
    setupKnownPhone();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add phone/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: /pairing qr code/i });

    await new Promise((r) => setTimeout(r, 300)); // several polls, nothing changes

    expect(within(dialog).getByText(/waiting for the phone/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/connected/i)).not.toBeInTheDocument();
  });
});

describe('clear all messages (All phones page)', () => {
  const setup = async ({ selectPhone = false } = {}) => {
    mockApi({
      devices: [device({ deviceId: 'a', name: 'Kitchen' })],
      messages: [message({ deviceId: 'a', body: 'keep me maybe' })],
    });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await screen.findByText('keep me maybe');
    if (selectPhone) await user.click(await screen.findByRole('button', { name: /kitchen/i }));
    return user;
  };
  const openDialog = async (user) => {
    await user.click(await screen.findByRole('button', { name: /clear all messages/i }));
    return screen.findByRole('dialog', { name: /clear all messages/i });
  };

  it('has the button on the All phones page, and not inside Settings', async () => {
    const user = await setup();
    expect(screen.getByRole('button', { name: /clear all messages/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    const settings = await screen.findByRole('dialog', { name: /settings/i });
    expect(within(settings).queryByRole('button', { name: /clear all messages/i })).not.toBeInTheDocument();
  });

  it('is not shown when a single phone is open (that page has Manage phone)', async () => {
    await setup({ selectPhone: true });

    expect(screen.queryByRole('button', { name: /clear all messages/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage phone/i })).toBeInTheDocument();
  });

  it('asks before clearing, and cancelling sends nothing', async () => {
    let called = false;
    server.use(http.delete('/api/v1/messages', () => { called = true; return HttpResponse.json({ deleted: 1 }); }));
    const user = await setup();

    const dialog = await openDialog(user);
    expect(within(dialog).getByText(/delete the messages of every phone/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(called).toBe(false);
    expect(screen.getByText('keep me maybe')).toBeInTheDocument();
  });

  it('deletes everything once confirmed, closes and empties the list', async () => {
    server.use(http.delete('/api/v1/messages', () => HttpResponse.json({ deleted: 7 })));
    const user = await setup();

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: /yes, clear/i }));

    await waitFor(() => expect(screen.queryByText('keep me maybe')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: /clear all messages/i })).not.toBeInTheDocument();
  });

  it('shows an error and keeps the list when the server refuses', async () => {
    server.use(http.delete('/api/v1/messages', () => HttpResponse.json({ error: 'x' }, { status: 500 })));
    const user = await setup();

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: /yes, clear/i }));

    expect(await within(dialog).findByText(/could not clear the messages/i)).toBeInTheDocument();
    expect(screen.getByText('keep me maybe')).toBeInTheDocument();
  });

  it('empties the list when another dashboard clears everything', async () => {
    await setup();

    act(() => FakeEventSource.current.emit('messages_cleared_all', {}));

    await waitFor(() => expect(screen.queryByText('keep me maybe')).not.toBeInTheDocument());
  });
});

describe('account dialog', () => {
  it('holds password and two-step login, and Settings no longer does', async () => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json({ retentionDays: null })),
      http.get('/api/v1/auth/me', () => HttpResponse.json({ username: 'admin', csrfToken: 'c', totpEnabled: false })),
    );
    mockApi({ devices: [device({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /^account$/i }));
    const account = await screen.findByRole('dialog', { name: /account/i });
    expect(within(account).getByRole('region', { name: /change password/i })).toBeInTheDocument();
    expect(await within(account).findByRole('region', { name: /two-step login/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    const settings = await screen.findByRole('dialog', { name: /settings/i });
    expect(within(settings).queryByRole('region', { name: /change password/i })).not.toBeInTheDocument();
    expect(within(settings).queryByRole('region', { name: /two-step login/i })).not.toBeInTheDocument();
    expect(within(settings).getByRole('region', { name: /end-to-end encryption/i })).toBeInTheDocument();
  });
});

describe('account: change password', () => {
  const setup = async () => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json({ retentionDays: null })),
      http.get('/api/v1/auth/me', () => HttpResponse.json({ username: 'admin', csrfToken: 'c', totpEnabled: false })),
    );
    mockApi({ devices: [device({ deviceId: 'a' })] });
    const user = userEvent.setup();
    render(<Dashboard username="admin" onLogout={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /account/i }));
    const dialog = await screen.findByRole('dialog', { name: /account/i });
    const fill = async (current, next, again = next) => {
      await user.type(await within(dialog).findByLabelText(/current password/i), current);
      await user.type(within(dialog).getByLabelText(/^new password/i), next);
      await user.type(within(dialog).getByLabelText(/repeat new password/i), again);
    };
    const submit = () => user.click(within(dialog).getByRole('button', { name: /change password/i }));
    return { user, dialog, fill, submit };
  };

  it('refuses a short password or a mismatch without sending anything', async () => {
    let called = false;
    server.use(http.post('/api/v1/auth/password', () => { called = true; return new HttpResponse(null, { status: 204 }); }));
    const { dialog, fill, submit } = await setup();

    await fill('old password 123', 'short');
    await submit();
    expect(within(dialog).getByText(/at least 12 characters/i)).toBeInTheDocument();

    await userEvent.setup().type(within(dialog).getByLabelText(/^new password/i), ' and more text');
    await submit();
    expect(within(dialog).getByText(/do not match/i)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('sends both passwords, says it worked and clears the fields', async () => {
    let sent;
    server.use(
      http.post('/api/v1/auth/password', async ({ request }) => {
        sent = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { dialog, fill, submit } = await setup();

    await fill('old password 123', 'a long enough new one');
    await submit();

    expect(await within(dialog).findByText(/password changed/i)).toBeInTheDocument();
    expect(sent).toEqual({ currentPassword: 'old password 123', newPassword: 'a long enough new one' });
    expect(within(dialog).getByLabelText(/current password/i)).toHaveValue('');
  });

  it('says when the current password is wrong', async () => {
    server.use(http.post('/api/v1/auth/password', () => HttpResponse.json({ error: 'wrong_password' }, { status: 400 })));
    const { dialog, fill, submit } = await setup();

    await fill('not mine at all', 'a long enough new one');
    await submit();

    expect(await within(dialog).findByText(/current password is not correct/i)).toBeInTheDocument();
  });
});
