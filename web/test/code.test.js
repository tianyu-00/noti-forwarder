import { splitAroundCode } from "../src/code.js";

describe("splitAroundCode", () => {
  it("splits the text around the code", () => {
    expect(
      splitAroundCode("Your code is 482913, do not share it", "482913"),
    ).toEqual([
      { text: "Your code is ", isCode: false },
      { text: "482913", isCode: true },
      { text: ", do not share it", isCode: false },
    ]);
  });

  it("highlights the code as it was written, including spaces or dashes inside it", () => {
    expect(
      splitAroundCode("Code: 123 456 expires soon", "123456").find(
        (p) => p.isCode,
      ).text,
    ).toBe("123 456");
    expect(
      splitAroundCode("Code: 123-456", "123456").find((p) => p.isCode).text,
    ).toBe("123-456");
  });

  it("does not highlight digits that are part of a longer number", () => {
    const parts = splitAroundCode("Ref 9123456 then code 123456", "123456");
    expect(parts.filter((p) => p.isCode)).toHaveLength(1);
    expect(parts[0].text).toBe("Ref 9123456 then code ");
  });

  it("returns the text untouched when there is no code, or the code cannot be found", () => {
    expect(splitAroundCode("Hello", null)).toEqual([
      { text: "Hello", isCode: false },
    ]);
    expect(splitAroundCode("Hello", "123456")).toEqual([
      { text: "Hello", isCode: false },
    ]);
  });

  it("ignores a code that is not just digits, so it can never act as a pattern", () => {
    expect(splitAroundCode("a.b", ".*")).toEqual([
      { text: "a.b", isCode: false },
    ]);
  });

  it("copes with a code at the very start or end", () => {
    expect(splitAroundCode("482913 is your code", "482913")).toEqual([
      { text: "482913", isCode: true },
      { text: " is your code", isCode: false },
    ]);
  });
});
