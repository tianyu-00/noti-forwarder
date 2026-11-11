import { http, HttpResponse } from 'msw';
import { server } from './server.js';

let counter = 0;

export function device(overrides = {}) {
  counter += 1;
  return {
    deviceId: `dev-${counter}`,
    name: `Phone ${counter}`,
    model: 'HD1913',
    appVersion: '0.1.0',
    pairedAt: '2026-11-01T10:00:00.000Z',
    lastSeen: new Date().toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

export function message(overrides = {}) {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    deviceId: 'dev-1',
    type: 'notification',
    app: 'com.example.app',
    sender: 'Sender',
    body: `Body ${counter}`,
    receivedAt: '2026-11-11T10:00:00.000Z',
    createdAt: '2026-11-11T10:00:01.000Z',
    ...overrides,
  };
}

// Installs handlers for the dashboard and records each message-list request URL.
export function mockApi({ devices = [], messages = [], messagesResponse } = {}) {
  const requests = { messages: [] };
  server.use(
    http.get('/api/v1/devices', () => HttpResponse.json({ devices })),
    http.get('/api/v1/messages', ({ request }) => {
      const url = new URL(request.url);
      requests.messages.push(url.searchParams);
      return HttpResponse.json(messagesResponse?.(url.searchParams) ?? { messages, nextBefore: null });
    }),
  );
  return requests;
}
