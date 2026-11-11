import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server.js';
import { FakeEventSource } from './fake-event-source.js';

globalThis.EventSource = FakeEventSource;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  FakeEventSource.reset();
});
afterAll(() => server.close());
