import { render, screen, within, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import Dashboard from "../src/Dashboard.jsx";
import { device, mockApi } from "./fixtures.js";
import { FakeEventSource } from "./fake-event-source.js";

async function open(devices) {
  mockApi({ devices, messages: [] });
  server.use(
    http.get("/api/v1/devices", () =>
      HttpResponse.json({ devices, silentAfterMinutes: 120 }),
    ),
  );
  render(<Dashboard username="admin" onLogout={() => {}} />);
  const nav = await screen.findByRole("navigation", { name: /phones/i });
  await within(nav).findByRole("button", { name: /kitchen/i });
  return within(nav).getByRole("button", { name: /kitchen/i });
}

describe("a phone's battery in the phone list", () => {
  it("shows the level the phone last reported", async () => {
    const row = await open([
      device({ name: "Kitchen", battery: { percent: 42, charging: false } }),
    ]);

    expect(within(row).getByRole("img", { name: "Battery 42%" })).toBeInTheDocument();
    expect(within(row).getByText("42%")).toBeInTheDocument();
  });

  it("says when it is charging", async () => {
    const row = await open([
      device({ name: "Kitchen", battery: { percent: 42, charging: true } }),
    ]);

    expect(
      within(row).getByRole("img", { name: "Battery 42%, charging" }),
    ).toBeInTheDocument();
  });

  it("marks a low level that is not charging", async () => {
    const row = await open([
      device({ name: "Kitchen", battery: { percent: 12, charging: false } }),
    ]);

    expect(
      within(row).getByRole("img", { name: "Battery 12%, low" }),
    ).toBeInTheDocument();
  });

  it("does not call a low level that is charging low", async () => {
    const row = await open([
      device({ name: "Kitchen", battery: { percent: 12, charging: true } }),
    ]);

    expect(
      within(row).getByRole("img", { name: "Battery 12%, charging" }),
    ).toBeInTheDocument();
  });

  it("shows nothing for a phone that has never reported one", async () => {
    const row = await open([device({ name: "Kitchen", battery: null })]);

    expect(within(row).queryByRole("img", { name: /battery/i })).toBeNull();
  });

  it("shows nothing for a revoked phone", async () => {
    const row = await open([
      device({
        name: "Kitchen",
        revokedAt: "2026-11-10T10:00:00.000Z",
        battery: { percent: 80, charging: false },
      }),
    ]);

    expect(within(row).queryByRole("img", { name: /battery/i })).toBeNull();
  });

  it("follows the phone's check-ins without a reload", async () => {
    const d = device({
      name: "Kitchen",
      battery: { percent: 42, charging: false },
    });
    const row = await open([d]);

    act(() => {
      FakeEventSource.current.emit("device_seen", {
        deviceId: d.deviceId,
        lastSeen: new Date().toISOString(),
        battery: { percent: 41, charging: false },
      });
    });

    expect(await within(row).findByRole("img", { name: "Battery 41%" })).toBeInTheDocument();
  });

  it("keeps the old level when a check-in carries none", async () => {
    const d = device({
      name: "Kitchen",
      battery: { percent: 42, charging: false },
    });
    const row = await open([d]);

    act(() => {
      FakeEventSource.current.emit("device_seen", {
        deviceId: d.deviceId,
        lastSeen: new Date().toISOString(),
      });
    });

    expect(within(row).getByRole("img", { name: "Battery 42%" })).toBeInTheDocument();
  });
});
