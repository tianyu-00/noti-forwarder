// Stand-in for the browser EventSource so tests can push live events.
export class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }

  close() {
    this.closed = true;
  }

  // Test helper: deliver an event as the server would.
  emit(type, data) {
    for (const fn of this.listeners[type] || [])
      fn({ data: JSON.stringify(data) });
  }

  static get current() {
    return FakeEventSource.instances.filter((i) => !i.closed).at(-1);
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}
