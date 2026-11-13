import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeToggle from "../src/ThemeToggle.jsx";
import { initTheme } from "../src/theme.js";

function systemPrefers(scheme) {
  window.matchMedia = (query) => ({
    matches: query.includes("dark") ? scheme === "dark" : scheme === "light",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("follows the system setting until the user chooses", () => {
    systemPrefers("dark");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");

    systemPrefers("light");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("offers to switch to the other theme, and switches when clicked", async () => {
    systemPrefers("dark");
    initTheme();
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole("button", { name: /switch to light theme/i }),
    );

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(
      screen.getByRole("button", { name: /switch to dark theme/i }),
    ).toBeInTheDocument();
  });

  it("remembers the choice for next time, over the system setting", async () => {
    systemPrefers("dark");
    initTheme();
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(
      screen.getByRole("button", { name: /switch to light theme/i }),
    );

    document.documentElement.removeAttribute("data-theme");
    initTheme();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("still works when the browser blocks storage", async () => {
    systemPrefers("dark");
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    initTheme();
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole("button", { name: /switch to light theme/i }),
    );

    expect(document.documentElement.dataset.theme).toBe("light");
    blocked.mockRestore();
    vi.restoreAllMocks();
  });
});
