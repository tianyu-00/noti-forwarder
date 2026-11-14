import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import Dashboard from "../src/Dashboard.jsx";
import { device, message, mockApi, reply } from "./fixtures.js";
import { server } from "./server.js";
import { FakeEventSource } from "./fake-event-source.js";
import { decryptField, generateKey } from "../src/e2e.js";
import { clearKey, setKey } from "../src/keyStore.js";
import { encryptField } from "./e2e-helpers.js";

const KEY = generateKey();
afterEach(() => clearKey());

const NUMBER = "+15551234567";
const text = (o) =>
  message({
    deviceId: "a",
    type: "sms",
    app: "sms",
    sender: NUMBER,
    body: "Are you coming?",
    ...o,
  });

// Opens the dashboard on one SMS conversation. `posted` collects what the page sends to the outbox.
async function open({
  messages = [text()],
  replies = [],
  devices = [device({ deviceId: "a", name: "Kitchen" })],
  post,
} = {}) {
  const posted = [];
  mockApi({ devices, messages });
  server.use(
    http.get("/api/v1/outbox", () => HttpResponse.json({ replies })),
    http.post("/api/v1/outbox", async ({ request }) => {
      const body = await request.json();
      posted.push(body);
      if (post) return post(body);
      return HttpResponse.json(
        reply({ deviceId: body.deviceId, to: body.to, body: body.body }),
        { status: 201 },
      );
    }),
  );
  render(<Dashboard username="admin" onLogout={() => {}} />);
  const thread = await screen.findByRole("region");
  return { posted, thread };
}
const box = (thread) => within(thread).getByRole("textbox", { name: /reply/i });
const sendButton = (thread) =>
  within(thread).getByRole("button", { name: "Send reply" });

describe("replying to a text from the dashboard", () => {
  it("has a reply box that is on in a text conversation, and the send button waits for some text", async () => {
    const user = userEvent.setup();
    const { thread } = await open();

    expect(box(thread)).toBeEnabled();
    expect(sendButton(thread)).toBeDisabled();
    await user.type(box(thread), "   ");
    expect(sendButton(thread)).toBeDisabled();
    await user.type(box(thread), "On my way");
    expect(sendButton(thread)).toBeEnabled();
  });

  it("is switched off for an app's notifications, which cannot be answered", async () => {
    const { thread } = await open({
      messages: [
        message({
          deviceId: "a",
          type: "notification",
          app: "com.app",
          sender: "Title",
        }),
      ],
    });

    expect(box(thread)).toBeDisabled();
    expect(box(thread)).toHaveAttribute(
      "placeholder",
      "You can only reply to text messages",
    );
  });

  it("is switched off for a phone that is unpaired", async () => {
    const { thread } = await open({
      devices: [
        device({
          deviceId: "a",
          name: "Kitchen",
          revokedAt: "2026-11-10T10:00:00.000Z",
        }),
      ],
    });

    expect(box(thread)).toBeDisabled();
    expect(box(thread)).toHaveAttribute(
      "placeholder",
      "This phone is unpaired",
    );
  });

  it("sends the reply to the sender's number, empties the box and shows it as sending", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open();

    await user.type(box(thread), "On my way");
    await user.click(sendButton(thread));

    await waitFor(() =>
      expect(posted).toEqual([
        { deviceId: "a", to: NUMBER, body: "On my way" },
      ]),
    );
    const mine = await within(thread).findByRole("group", {
      name: "Your reply",
    });
    expect(mine).toHaveTextContent("On my way");
    expect(mine).toHaveTextContent(/sending/i);
    expect(box(thread)).toHaveValue("");
  });

  it("sends with the Enter key, and Shift+Enter makes a new line instead", async () => {
    const user = userEvent.setup();
    const { posted, thread } = await open();

    await user.type(box(thread), "line one{Shift>}{Enter}{/Shift}line two");
    expect(posted).toEqual([]);
    await user.type(box(thread), "{Enter}");

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toBe("line one\nline two");
  });

  it("follows the reply live: sent, or failed with a reason in plain words", async () => {
    const user = userEvent.setup();
    const { thread } = await open();
    await user.type(box(thread), "On my way");
    await user.click(sendButton(thread));
    const mine = await within(thread).findByRole("group", {
      name: "Your reply",
    });
    const queued = reply({ deviceId: "a", to: NUMBER, body: "On my way" });

    // The page shows the id the server gave the reply.
    const id = mine.getAttribute("data-reply-id");
    act(() =>
      FakeEventSource.current.emit("outbox", {
        ...queued,
        id,
        status: "sent",
        sentAt: "2026-11-11T10:06:00.000Z",
      }),
    );
    await waitFor(() => expect(mine).toHaveTextContent(/sent/i));
    expect(mine).not.toHaveTextContent(/sending/i);

    act(() =>
      FakeEventSource.current.emit("outbox", {
        ...queued,
        id,
        status: "failed",
        error: "no_permission",
      }),
    );
    await waitFor(() => expect(mine).toHaveTextContent(/not sent/i));
    expect(mine).toHaveTextContent(/may not send texts/i);

    act(() =>
      FakeEventSource.current.emit("outbox", {
        ...queued,
        id,
        status: "failed",
        error: "expired",
      }),
    );
    await waitFor(() => expect(mine).toHaveTextContent(/offline too long/i));

    const words = {
      practice: /practice mode.*nothing was delivered/i,
      choose_sim: /two sims.*choose which one/i,
      sim_missing: /chosen sim is not in the phone/i,
      sim_unknown: /could not check the sim/i,
      no_service: /no mobile signal/i,
    };
    for (const [error, expected] of Object.entries(words)) {
      act(() =>
        FakeEventSource.current.emit("outbox", {
          ...queued,
          id,
          status: "failed",
          error,
        }),
      );
      await waitFor(() => expect(mine).toHaveTextContent(expected));
    }
  });

  it("shows replies that were queued earlier or from another dashboard", async () => {
    const { thread } = await open({
      replies: [
        reply({
          deviceId: "a",
          to: NUMBER,
          body: "Earlier reply",
          status: "sent",
        }),
      ],
    });

    expect(
      await within(thread).findByText("Earlier reply"),
    ).toBeInTheDocument();

    act(() =>
      FakeEventSource.current.emit(
        "outbox",
        reply({ deviceId: "a", to: NUMBER, body: "From my laptop" }),
      ),
    );
    expect(
      await within(thread).findByText("From my laptop"),
    ).toBeInTheDocument();
  });

  it("keeps a reply out of a thread with another number", async () => {
    const { thread } = await open({
      replies: [
        reply({ deviceId: "a", to: "+15550000000", body: "For someone else" }),
      ],
    });

    await within(thread).findByText("Are you coming?");
    expect(within(thread).queryByText("For someone else")).toBeNull();
  });

  it("says so, and keeps the text, when the reply could not be queued", async () => {
    const user = userEvent.setup();
    const { thread } = await open({
      post: () => HttpResponse.json({ error: "rate_limited" }, { status: 429 }),
    });

    await user.type(box(thread), "On my way");
    await user.click(sendButton(thread));

    expect(await within(thread).findByRole("alert")).toHaveTextContent(
      /could not send the reply/i,
    );
    expect(box(thread)).toHaveValue("On my way");
  });

  it("drops a phone's replies when its messages are cleared", async () => {
    const { thread } = await open({
      replies: [reply({ deviceId: "a", to: NUMBER, body: "Earlier reply" })],
    });
    await within(thread).findByText("Earlier reply");

    act(() =>
      FakeEventSource.current.emit("messages_cleared", { deviceId: "a" }),
    );

    await waitFor(() => expect(screen.queryByText("Earlier reply")).toBeNull());
  });
});

describe("replying in an encrypted conversation", () => {
  const sealed = () =>
    text({
      sender: encryptField(KEY, "sender", NUMBER),
      body: encryptField(KEY, "body", "Are you coming?"),
    });

  it("encrypts the number and the text in the browser, so the server only sees scrambled text", async () => {
    setKey(KEY);
    const user = userEvent.setup();
    const { posted, thread } = await open({ messages: [sealed()] });

    await user.type(box(thread), "On my way");
    await user.click(sendButton(thread));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].to).toMatch(/^e2e:v1:/);
    expect(posted[0].body).toMatch(/^e2e:v1:/);
    expect(JSON.stringify(posted[0])).not.toContain("On my way");
    expect(decryptField(KEY, "reply-to", posted[0].to)).toBe(NUMBER);
    expect(decryptField(KEY, "reply-body", posted[0].body)).toBe("On my way");
  });

  it("shows replies from the server decrypted", async () => {
    setKey(KEY);
    const { thread } = await open({
      messages: [sealed()],
      replies: [
        reply({
          deviceId: "a",
          to: encryptField(KEY, "reply-to", NUMBER),
          body: encryptField(KEY, "reply-body", "Plain again"),
          status: "sent",
        }),
      ],
    });

    expect(await within(thread).findByText("Plain again")).toBeInTheDocument();
    expect(thread).not.toHaveTextContent("e2e:v1");
  });

  it("stays plain when the conversation is plain, even if this browser has a key", async () => {
    setKey(KEY);
    const user = userEvent.setup();
    const { posted, thread } = await open();

    await user.type(box(thread), "On my way");
    await user.click(sendButton(thread));

    await waitFor(() =>
      expect(posted).toEqual([
        { deviceId: "a", to: NUMBER, body: "On my way" },
      ]),
    );
  });

  it("cannot reply to an encrypted conversation without the key", async () => {
    const { thread } = await open({ messages: [sealed()] });

    expect(box(thread)).toBeDisabled();
    expect(box(thread)).toHaveAttribute(
      "placeholder",
      "Add the encryption key in Settings to reply",
    );
  });
});
