import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path));
// A PNG starts with an 8 byte signature, then the IHDR chunk whose width and height are 32-bit numbers.
const size = (path) => {
  const bytes = read(path);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe("app icons", () => {
  it("has the install icons at the sizes the manifest promises", () => {
    expect(size("public/icon-192.png")).toEqual([192, 192]);
    expect(size("public/icon-512.png")).toEqual([512, 512]);
  });

  it("has a full-bleed maskable icon, so a phone can crop it to its own shape", () => {
    expect(size("public/icon-maskable-512.png")).toEqual([512, 512]);
    expect(read("vite.config.js").toString()).toMatch(
      /icon-maskable-512\.png[^}]*maskable/,
    );
  });

  it("has an iPhone home screen icon", () => {
    expect(size("public/apple-touch-icon.png")).toEqual([180, 180]);
    expect(read("index.html").toString()).toMatch(/rel="apple-touch-icon"/);
  });

  it("has a favicon for the browser tab, drawn as the arch", () => {
    const svg = read("public/favicon.svg").toString();
    expect(svg).toContain("<svg");
    expect(svg).toMatch(/<path[^>]*d="M34 78 V54/); // the arch
    expect(read("index.html").toString()).toMatch(
      /rel="icon"[^>]*favicon\.svg/,
    );
  });
});
