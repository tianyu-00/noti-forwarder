import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './server.js';
import App from '../src/App.jsx';

describe('login', () => {
  it('shows the sign-in form to a logged-out visitor', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  async function fillAndSubmit(user, username, password) {
    await user.type(await screen.findByLabelText(/username/i), username);
    await user.type(screen.getByLabelText(/password/i), password);
    await user.click(screen.getByRole('button', { name: /sign in/i }));
  }

  it('shows an error for wrong credentials and stays on the form', async () => {
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
      http.post('/api/v1/auth/login', () => HttpResponse.json({ error: 'invalid_credentials' }, { status: 401 })),
    );
    const user = userEvent.setup();
    render(<App />);

    await fillAndSubmit(user, 'admin', 'wrong password');

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect username or password/i);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('tells the user when the account is locked', async () => {
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
      http.post('/api/v1/auth/login', () => HttpResponse.json({ error: 'locked' }, { status: 429 })),
    );
    const user = userEvent.setup();
    render(<App />);

    await fillAndSubmit(user, 'admin', 'whatever');

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('sends the credentials and signs in on success', async () => {
    let sent;
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
      http.post('/api/v1/auth/login', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ username: 'admin', csrfToken: 'csrf-1' });
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await fillAndSubmit(user, 'admin', 'right password');

    expect(await screen.findByText(/signed in as admin/i)).toBeInTheDocument();
    expect(sent).toEqual({ username: 'admin', password: 'right password' });
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });
});

describe('insecure connection notice', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  function setSecure(value) {
    Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
  }
  afterEach(() => {
    if (original) Object.defineProperty(window, 'isSecureContext', original);
    else delete window.isSecureContext;
  });

  it('warns on the sign-in page that staying signed in needs HTTPS', async () => {
    setSecure(false);
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));

    render(<App />);

    expect(await screen.findByRole('status')).toHaveTextContent(/https/i);
  });

  it('shows no warning on a secure page', async () => {
    setSecure(true);
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));

    render(<App />);

    await screen.findByRole('heading', { name: /sign in/i });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('login with two-factor on', () => {
  const loggedOut = () => http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 }));
  const submit = async (user, label) => {
    await user.click(screen.getByRole('button', { name: label }));
  };

  async function reachCodeStep(user) {
    await user.type(await screen.findByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'right password');
    await submit(user, /sign in/i);
    return screen.findByLabelText(/authenticator or backup code/i);
  }

  it('asks for the code when the server wants one, then signs in with it', async () => {
    const bodies = [];
    server.use(
      loggedOut(),
      http.post('/api/v1/auth/login', async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return body.code
          ? HttpResponse.json({ username: 'admin', csrfToken: 'csrf-1' })
          : HttpResponse.json({ error: 'totp_required' }, { status: 401 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    const codeField = await reachCodeStep(user);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // not an error, just the next step
    await user.type(codeField, '482913');
    await submit(user, /sign in/i);

    expect(await screen.findByText(/signed in as admin/i)).toBeInTheDocument();
    expect(bodies).toEqual([
      { username: 'admin', password: 'right password' },
      { username: 'admin', password: 'right password', code: '482913' },
    ]);
  });

  it('says the code was not accepted and stays on the code step', async () => {
    server.use(
      loggedOut(),
      http.post('/api/v1/auth/login', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          { error: body.code ? 'invalid_credentials' : 'totp_required' },
          { status: 401 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(await reachCodeStep(user), '000000');
    await submit(user, /sign in/i);

    expect(await screen.findByRole('alert')).toHaveTextContent(/code was not accepted/i);
    expect(screen.getByLabelText(/authenticator or backup code/i)).toBeInTheDocument();
  });

  it('does not show the code field for an ordinary login', async () => {
    server.use(loggedOut());
    render(<App />);
    await screen.findByRole('heading', { name: /sign in/i });
    expect(screen.queryByLabelText(/authenticator or backup code/i)).not.toBeInTheDocument();
  });
});
