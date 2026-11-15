import { render, screen } from "@testing-library/react";
import Logo from "../src/Logo.jsx";
import Dashboard from "../src/Dashboard.jsx";
import { mockApi } from "./fixtures.js";

describe("the brand mark", () => {
  it("is the arch with a dot, hidden from screen readers because the name sits beside it", () => {
    const { container } = render(<Logo />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelector("path")).not.toBeNull(); // the arch
    expect(svg.querySelector("circle")).not.toBeNull(); // the dot
  });

  it("replaces the letter N in the dashboard sidebar", async () => {
    mockApi({});
    const { container } = render(
      <Dashboard username="admin" onLogout={() => {}} />,
    );

    await screen.findByText("Notiforwarder");

    expect(container.querySelector("aside svg")).not.toBeNull();
    expect(screen.queryByText("N", { exact: true })).toBeNull();
  });
});
