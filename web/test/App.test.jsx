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
