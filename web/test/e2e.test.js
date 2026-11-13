import {
  decryptField,
  encryptField,
  generateKey,
  isEncrypted,
  isValidKey,
} from "../src/e2e.js";

// Made by a separate script with Node's own crypto. The Android tests use the same vector, so
// both sides are proven to agree on the byte format.
const VECTOR = {
  key: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  field: "body",
  plaintext: "Your code is 482913",
  blob: "e2e:v1:Ii4dPFsHI_YnQXKyUD-DnROc_iU0H0iXDw40L_-M-fU9epD9NRdemW2c3BmEtRw",
};

describe("end-to-end encryption format", () => {
  it("decrypts the reference message", () => {
    expect(decryptField(VECTOR.key, VECTOR.field, VECTOR.blob)).toBe(
      VECTOR.plaintext,
    );
  });

  it("recognises encrypted text by its prefix", () => {
    expect(isEncrypted(VECTOR.blob)).toBe(true);
    expect(isEncrypted("Your code is 482913")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it("refuses a wrong key, a different field (so body and sender cannot be swapped) and a changed message", () => {
    const otherKey = generateKey();
    const flipped = `${VECTOR.blob.slice(0, -3)}${VECTOR.blob.endsWith("AAA") ? "BBB" : "AAA"}`;

    expect(() => decryptField(otherKey, VECTOR.field, VECTOR.blob)).toThrow();
    expect(() => decryptField(VECTOR.key, "sender", VECTOR.blob)).toThrow();
    expect(() => decryptField(VECTOR.key, VECTOR.field, flipped)).toThrow();
    expect(() => decryptField(VECTOR.key, VECTOR.field, "e2e:v1:")).toThrow();
  });

  it("makes a fresh 256-bit key each time and validates a key", () => {
    const a = generateKey();
    const b = generateKey();

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isValidKey(a)).toBe(true);
    expect(isValidKey(`${a}x`)).toBe(false);
    expect(isValidKey("not a key")).toBe(false);
    expect(isValidKey("")).toBe(false);
  });
});

// Reply text made by a separate Node script. The Android tests decrypt the same two values.
const REPLY_VECTOR = {
  to: "e2e:v1:eRE2mGyk26zCvJ9DQDOdL9sPPYIvagaIBZLDakFS8dqePXfeDqejsw",
  body: "e2e:v1:NZoxaKYmRRH5ShFxwuztOqsIncHN-Ou3_Hh9zsOv9TPQkn6bWoARZA",
};

describe("encrypting a reply in the browser", () => {
  it("reads the reference reply that the phone also decrypts", () => {
    expect(decryptField(VECTOR.key, "reply-to", REPLY_VECTOR.to)).toBe(
      "+15551234567",
    );
    expect(decryptField(VECTOR.key, "reply-body", REPLY_VECTOR.body)).toBe(
      "On my way é",
    );
  });

  it("makes text the same decryptor reads back, for the field it was made for", () => {
    const blob = encryptField(VECTOR.key, "reply-body", "On my way");

    expect(isEncrypted(blob)).toBe(true);
    expect(blob).not.toContain("On my way");
    expect(decryptField(VECTOR.key, "reply-body", blob)).toBe("On my way");
  });

  it("uses a fresh nonce each time, so the same text never gives the same bytes", () => {
    const a = encryptField(VECTOR.key, "reply-body", "hi");
    const b = encryptField(VECTOR.key, "reply-body", "hi");

    expect(a).not.toBe(b);
  });

  it("cannot be moved to another field, such as from the number to the text", () => {
    const blob = encryptField(VECTOR.key, "reply-to", "+15551234567");

    expect(() => decryptField(VECTOR.key, "reply-body", blob)).toThrow();
    expect(() => decryptField(VECTOR.key, "body", blob)).toThrow();
  });

  it("handles accents and emoji, and refuses a bad key", () => {
    const text = "Café ☕ 你好";

    expect(
      decryptField(
        VECTOR.key,
        "reply-body",
        encryptField(VECTOR.key, "reply-body", text),
      ),
    ).toBe(text);
    expect(() => encryptField("short", "reply-body", "x")).toThrow();
  });
});
