import { avatarInitial, avatarTone } from "../src/avatar.js";

describe("avatarInitial", () => {
  it("uses the first letter, upper case", () => {
    expect(avatarInitial("northwind")).toBe("N");
  });

  it("skips the dots of an app package name's prefix", () => {
    expect(avatarInitial("com.parcels.app")).toBe("P");
  });

  it("uses a plus for a phone number", () => {
    expect(avatarInitial("+44 7700 900123")).toBe("+");
  });

  it("falls back to a question mark for nothing", () => {
    expect(avatarInitial("")).toBe("?");
  });
});

describe("avatarTone", () => {
  it("is always one of the six tones", () => {
    for (const name of ["a", "Bank", "com.x.y", "+44 1", "", "ünï"]) {
      expect(avatarTone(name)).toBeGreaterThanOrEqual(1);
      expect(avatarTone(name)).toBeLessThanOrEqual(6);
    }
  });

  it("gives the same name the same tone every time", () => {
    expect(avatarTone("Northwind")).toBe(avatarTone("Northwind"));
  });
});
