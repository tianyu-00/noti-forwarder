import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import Dashboard from "../src/Dashboard.jsx";
import { device, message, mockApi, reply } from "./fixtures.js";
import { server } from "./server.js";
import { FakeEventSource } from "./fake-event-source.js";

// A dual-SIM phone: the dashboard offers the phone's SIMs, defaults to the SIM that received the text,
// and shows the ones the phone does not allow greyed out rather than hiding them.
const NUMBER = "+15551234567";
const CHINA = { id: 3, slot: 1, name: "China Mobile", allowed: true };
const THREE = { id: 5, slot: 2, name: "Three UK", allowed: true };
const text = (o) =>
  message({
    deviceId: "a",
    type: "sms",
    app: "sms",
    sender: NUMBER,
    body: "Are you coming?",
    ...o,
  });

async function open({ sims, messages = [text({ sim: 3 })] } = {}) {
  const posted = [];
  mockApi({
    devices: [device({ deviceId: "a", name: "Kitchen", sims })],
    messages,
  });
  server.use(
    http.get("/api/v1/outbox", () => HttpResponse.json({ replies: [] })),
    http.post("/api/v1/outbox", async ({ request }) => {
      const body = await request.json();
      posted.push(body);
      return HttpResponse.json(
        reply({
          deviceId: body.deviceId,
          to: body.to,
          body: body.body,
          sim: body.sim ?? null,
        }),
        {
          status: 201,
        },
      );
    }),
  );
  render(<Dashboard username="admin" onLogout={() => {}} />);
  const thread = await screen.findByRole("region");
  return { posted, thread };
}
const simBox = (thread) =>
  within(thread).queryByRole("combobox", { name: "Send from SIM" });
const box = (thread) => within(thread).getByRole("textbox", { name: /reply/i });
const send = (thread) =>
  within(thread).getByRole("button", { name: "Send reply" });

describe("choosing the SIM for a reply", () => {
  it("shows no SIM choice for a phone that has not listed its SIMs, and sends as before", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open({ sims: null });

    expect(simBox(thread)).toBeNull();
    await user.type(box(thread), "On my way");
    await user.click(send(thread));

    await waitFor(() =>
      expect(posted).toEqual([
        { deviceId: "a", to: NUMBER, body: "On my way" },
      ]),
    );
  });

  it("lists the phone's SIMs by slot and carrier", async () => {
    const { thread } = await open({ sims: [CHINA, THREE] });

    const options = within(simBox(thread)).getAllByRole("option");

    expect(options.map((o) => o.textContent)).toEqual([
      "SIM 1 · China Mobile",
      "SIM 2 · Three UK",
    ]);
  });

  it("starts on the SIM that received the text, and sends on it", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open({
      sims: [CHINA, THREE],
      messages: [text({ sim: 5 })],
    });

    expect(simBox(thread)).toHaveValue("5");
    await user.type(box(thread), "On my way");
    await user.click(send(thread));

    await waitFor(() =>
      expect(posted).toEqual([
        { deviceId: "a", to: NUMBER, body: "On my way", sim: 5 },
      ]),
    );
  });

  it("lets the dashboard pick another SIM the phone allows", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open({
      sims: [CHINA, THREE],
      messages: [text({ sim: 3 })],
    });

    await user.selectOptions(simBox(thread), "5");
    await user.type(box(thread), "On my way");
    await user.click(send(thread));

    await waitFor(() => expect(posted[0].sim).toBe(5));
  });

  it("greys out a SIM the phone does not allow, but still shows it", async () => {
    const { thread } = await open({
      sims: [{ ...CHINA, allowed: false }, THREE],
    });

    const blocked = within(simBox(thread)).getByRole("option", {
      name: /China Mobile/,
    });

    expect(blocked).toBeDisabled();
    expect(blocked).toHaveTextContent("not allowed on the phone");
  });

  it("does not start on the receiving SIM when the phone does not allow it", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open({
      sims: [{ ...CHINA, allowed: false }, THREE],
      messages: [text({ sim: 3 })],
    });

    // Three UK is the only SIM left, so it is chosen for the user.
    expect(simBox(thread)).toHaveValue("5");
    await user.type(box(thread), "hi");
    await user.click(send(thread));
    await waitFor(() => expect(posted[0].sim).toBe(5));
  });

  it("asks for a choice when several SIMs are allowed and none received the text", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open({
      sims: [CHINA, THREE],
      messages: [text({ sim: null })],
    });

    expect(simBox(thread)).toHaveValue("");
    await user.type(box(thread), "hi");
    expect(send(thread)).toBeDisabled();
    await user.selectOptions(simBox(thread), "3");
    expect(send(thread)).toBeEnabled();
    await user.click(send(thread));
    await waitFor(() => expect(posted[0].sim).toBe(3));
  });

  it("switches the reply box off when the phone allows no SIM at all", async () => {
    const { thread } = await open({
      sims: [
        { ...CHINA, allowed: false },
        { ...THREE, allowed: false },
      ],
    });

    expect(box(thread)).toBeDisabled();
    expect(box(thread)).toHaveAttribute(
      "placeholder",
      "This phone allows no SIM for replies",
    );
  });

  it("follows the phone when it changes which SIMs it allows", async () => {
    const { thread } = await open({
      sims: [CHINA, { ...THREE, allowed: false }],
      messages: [text({ sim: null })],
    });
    expect(simBox(thread)).toHaveValue("3");

    act(() =>
      FakeEventSource.current.emit("device_sims", {
        deviceId: "a",
        sims: [{ ...CHINA, allowed: false }, THREE],
      }),
    );

    await waitFor(() => expect(simBox(thread)).toHaveValue("5"));
    expect(
      within(simBox(thread)).getByRole("option", { name: /China Mobile/ }),
    ).toBeDisabled();
  });
});
