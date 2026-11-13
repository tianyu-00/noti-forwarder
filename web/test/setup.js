import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./server.js";
import { FakeEventSource } from "./fake-event-source.js";
import { FakeIntersectionObserver } from "./fake-intersection-observer.js";

globalThis.EventSource = FakeEventSource;
globalThis.IntersectionObserver = FakeIntersectionObserver;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  FakeEventSource.reset();
  FakeIntersectionObserver.reset();
});
afterAll(() => server.close());
