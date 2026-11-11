import { render, screen } from '@testing-library/react';
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
});
