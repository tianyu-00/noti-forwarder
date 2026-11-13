import { clearKey, getKey, setKey } from "../src/keyStore.js";
import { generateKey } from "../src/e2e.js";

afterEach(() => clearKey());

describe("encryption key store", () => {
  it("keeps a valid key in this browser and forgets it again", () => {
    const key = generateKey();
    expect(getKey()).toBeNull();

    setKey(key);
    expect(getKey()).toBe(key);
    expect(localStorage.getItem("nf_e2e_key")).toBe(key);

    clearKey();
    expect(getKey()).toBeNull();
    expect(localStorage.getItem("nf_e2e_key")).toBeNull();
  });

  it("refuses a key that is not 32 bytes of base64url", () => {
    expect(() => setKey("nope")).toThrow();
    expect(getKey()).toBeNull();
  });

  it("tells listeners when the key changes", () => {
    const calls = [];
    const stop = (async () =>
      (await import("../src/keyStore.js")).subscribe(() =>
        calls.push(getKey()),
      ))();
    return stop.then((unsubscribe) => {
      const key = generateKey();
      setKey(key);
      clearKey();
      unsubscribe();
      expect(calls).toEqual([key, null]);
    });
  });
});
