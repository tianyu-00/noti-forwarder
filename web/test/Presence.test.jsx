import { render, screen, within, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import Dashboard from "../src/Dashboard.jsx";
import { device, mockApi } from "./fixtures.js";
import { FakeEventSource } from "./fake-event-source.js";

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

async function open(devices, silentAfterMinutes = 120) {
  mockApi({ devices });
  server.use(
    http.get("/api/v1/devices", () =>
      HttpResponse.json({ devices, silentAfterMinutes }),
    ),
  );
  render(<Dashboard username="admin" onLogout={() => {}} />);
  const nav = await screen.findByRole("navigation", { name: /phones/i });
  await within(nav).findByRole("button", { name: /kitchen/i });
  const row = () => within(nav).getByRole("button", { name: /kitchen/i });
  return {
    row,
    status: () =>
      within(row()).getByText(/online|last seen|quiet|never|revoked/i),
    dot: () => within(row()).queryByTestId("status-dot"),
  };
}

const kitchen = (overrides) =>
  device({ deviceId: "a", name: "Kitchen", ...overrides });

describe("connection dot", () => {
  it("pulses green for a phone that holds its connection, even if its last message is old", async () => {
    const { status, dot } = await open([
      kitchen({ lastSeen: minutesAgo(600), connected: true }),
    ]);

    expect(status()).toHaveTextContent("Online");
    expect(dot()).toHaveAttribute("data-state", "live");
    expect(dot()).toHaveAttribute("aria-hidden", "true"); // decorative: the words carry the meaning
  });

  it("stops pulsing the moment the connection drops, and starts again when it returns", async () => {
    const { status, dot } = await open([
      kitchen({ lastSeen: minutesAgo(600), connected: true }),
    ]);

    act(() =>
      FakeEventSource.current.emit("device_presence", {
        deviceId: "a",
        connected: false,
        lastSeen: minutesAgo(0),
      }),
    );
    expect(dot()).toHaveAttribute("data-state", "idle");
    expect(status()).toHaveTextContent(/last seen just now/i); // not "Online": the connection is gone

    act(() =>
      FakeEventSource.current.emit("device_presence", {
        deviceId: "a",
        connected: true,
        lastSeen: minutesAgo(0),
      }),
    );
    expect(dot()).toHaveAttribute("data-state", "live");
  });

  it('is not "Online" just because a message or check-in was recent: only the connection counts', async () => {
    const { dot, status } = await open([
      kitchen({ lastSeen: minutesAgo(1), connected: false }),
    ]);

    expect(status()).toHaveTextContent(/last seen 1 min ago/i);
    expect(dot()).toHaveAttribute("data-state", "idle");
  });

  it("is grey when seen a while ago", async () => {
    const { dot } = await open([
      kitchen({ lastSeen: minutesAgo(60), connected: false }),
    ]);
    expect(dot()).toHaveAttribute("data-state", "idle");
  });

  it("is red when the phone has gone quiet", async () => {
    const { dot, status } = await open([
      kitchen({ lastSeen: minutesAgo(300), connected: false }),
    ]);
    expect(dot()).toHaveAttribute("data-state", "quiet");
    expect(status()).toHaveTextContent(/quiet for 5 h/i);
  });

  it("has no dot for a revoked phone, and loses it when the phone is revoked live", async () => {
    const revoked = await open([
      kitchen({ revokedAt: minutesAgo(5), connected: false }),
    ]);
    expect(revoked.dot()).toBeNull();
  });

  it('drops the pulse and shows "Revoked" at once when a connected phone is revoked', async () => {
    const { status, dot } = await open([
      kitchen({ lastSeen: minutesAgo(0), connected: true }),
    ]);
    expect(dot()).toHaveAttribute("data-state", "live");

    act(() =>
      FakeEventSource.current.emit("device", {
        ...kitchen({ lastSeen: minutesAgo(0) }),
        revokedAt: minutesAgo(0),
      }),
    );

    expect(status()).toHaveTextContent(/revoked/i);
    expect(dot()).toBeNull();
  });
});
