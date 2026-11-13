import { matchesView } from "../src/matches.js";
import { message } from "./fixtures.js";

const view = (q) => ({ selected: null, filters: { type: "", app: "", q } });

describe("searching by app name", () => {
  const gmail = message({
    app: "com.google.android.gm",
    appLabel: "Gmail",
    sender: "Tian",
    body: "Run failed",
  });

  it("finds a message by the app's real name", () => {
    expect(matchesView(gmail, view("gmail"))).toBe(true);
  });

  it("still finds it by package name", () => {
    expect(matchesView(gmail, view("android.gm"))).toBe(true);
  });

  it("works for a message that has no real name", () => {
    const plain = message({ app: "com.bank", appLabel: null, body: "Hi" });

    expect(matchesView(plain, view("bank"))).toBe(true);
    expect(matchesView(plain, view("gmail"))).toBe(false);
  });
});
