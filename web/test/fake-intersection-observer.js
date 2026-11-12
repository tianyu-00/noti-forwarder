// Stand-in for the browser IntersectionObserver so tests decide when an element is "in view".
export class FakeIntersectionObserver {
  static instances = [];
  /** When true, an element counts as in view as soon as it is observed (a tall screen). */
  static startVisible = false;

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target) {
    this.targets.push(target);
    if (FakeIntersectionObserver.startVisible) queueMicrotask(() => this.trigger(true));
  }

  disconnect() {
    this.disconnected = true;
    this.targets = [];
  }

  // Test helper: report the observed element as in view (or not), like the browser would.
  trigger(isIntersecting) {
    if (this.disconnected) return;
    this.callback(this.targets.map((target) => ({ target, isIntersecting })));
  }

  static get active() {
    return FakeIntersectionObserver.instances.filter((i) => !i.disconnected);
  }

  static get current() {
    return FakeIntersectionObserver.active.at(-1);
  }

  static reset() {
    FakeIntersectionObserver.instances = [];
    FakeIntersectionObserver.startVisible = false;
  }
}
