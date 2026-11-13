import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "../src/Dashboard.jsx";
import { device, message, mockApi, phonesNav } from "./fixtures.js";
import { FakeEventSource } from "./fake-event-source.js";

const phones = [
  device({ deviceId: "a", name: "Kitchen phone" }),
  device({ deviceId: "b", name: "Spare phone" }),
];

// Newest first, as the server returns them.
function seed() {
  mockApi({
    devices: phones,
    messages: [
      message({
        deviceId: "a",
        type: "sms",
        app: "sms",
        sender: "NORTHWIND",
        body: "Your code is 482913",
        code: "482913",
        receivedAt: new Date().toISOString(),
      }),
      message({
        deviceId: "b",
        type: "notification",
        app: "com.parcels",
        sender: "Out for delivery",
        body: "Arriving today",
        receivedAt: "2026-11-01T09:00:00.000Z",
      }),
      message({
        deviceId: "a",
        type: "sms",
        app: "sms",
        sender: "NORTHWIND",
        body: "Welcome back",
        receivedAt: "2026-11-01T08:00:00.000Z",
      }),
    ],
  });
}

function setup() {
  seed();
  render(<Dashboard username="admin" onLogout={() => {}} />);
}

const conversations = async () =>
  within(await screen.findByRole("list", { name: "Conversations" }));

describe("conversation list", () => {
  it("shows one row per conversation with its phone and latest message", async () => {
    setup();

    const rows = (await conversations()).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("NORTHWIND");
    expect(rows[0]).toHaveTextContent("Kitchen phone");
    expect(rows[0]).toHaveTextContent("Your code is 482913");
    expect(rows[0]).not.toHaveTextContent("Welcome back");
    expect(rows[1]).toHaveTextContent("com.parcels");
    expect(rows[1]).toHaveTextContent("Spare phone");
  });

  it("says so when there are no conversations", async () => {
    mockApi({ devices: phones, messages: [] });
    render(<Dashboard username="admin" onLogout={() => {}} />);

    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
  });
});

describe("thread", () => {
  it("opens the newest conversation first, oldest message at the top", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    const articles = within(thread).getAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveTextContent("Welcome back");
    expect(articles[1]).toHaveTextContent("Your code is 482913");
  });

  it("shows another conversation when it is picked", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(
      (await conversations()).getByRole("button", { name: /com\.parcels/ }),
    );

    const thread = screen.getByRole("region", { name: "com.parcels" });
    expect(within(thread).getAllByRole("article")).toHaveLength(1);
    expect(thread).toHaveTextContent("Arriving today");
    expect(screen.queryByRole("region", { name: "NORTHWIND" })).toBeNull();
  });

  it("marks the open conversation in the list", async () => {
    const user = userEvent.setup();
    setup();

    const rows = (await conversations()).getAllByRole("button");
    expect(rows[0]).toHaveAttribute("aria-current", "true");

    await user.click(rows[1]);
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).not.toHaveAttribute("aria-current");
  });

  it("highlights the 2FA code with a copy button", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    expect(within(thread).getByText("482913").tagName).toBe("MARK");
    expect(
      within(thread).getByRole("button", { name: /copy code/i }),
    ).toBeInTheDocument();
  });

  it("shows a notification's title above its text", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(
      (await conversations()).getByRole("button", { name: /com\.parcels/ }),
    );

    const article = within(
      screen.getByRole("region", { name: "com.parcels" }),
    ).getByRole("article");
    expect(article).toHaveTextContent("Out for delivery");
    expect(article).toHaveTextContent("Arriving today");
  });

  it("does not repeat an SMS sender on every message", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    expect(within(thread).queryAllByText("NORTHWIND")).toHaveLength(1); // the header only
  });

  it("starts each day with a separator", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    expect(within(thread).getByText("Today")).toBeInTheDocument();
    expect(
      within(thread).getByText(
        new Date("2026-11-01T08:00:00.000Z").toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      ),
    ).toBeInTheDocument();
  });

  it("names the phone and kind of message in its header", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    expect(thread).toHaveTextContent("SMS");
    expect(thread).toHaveTextContent("Kitchen phone");
  });

  it("has a reply box that is switched off for now", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    const box = within(thread).getByRole("textbox", { name: /reply/i });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute(
      "placeholder",
      "Replying from this PC is not available yet",
    );
  });
});

describe("one pane at a time on a narrow screen", () => {
  it("offers a way back to the list only after a conversation was picked", async () => {
    const user = userEvent.setup();
    setup();

    const rows = (await conversations()).getAllByRole("button");
    expect(
      screen.queryByRole("button", { name: /back to conversations/i }),
    ).toBeNull();

    await user.click(rows[1]);
    await user.click(
      screen.getByRole("button", { name: /back to conversations/i }),
    );

    expect(
      screen.queryByRole("button", { name: /back to conversations/i }),
    ).toBeNull();
  });
});

describe("unread conversations", () => {
  const push = (m) =>
    act(() => FakeEventSource.current.emit("message", message(m)));
  const rowOf = async (name) =>
    (await conversations()).getByRole("button", { name: new RegExp(name) });

  it("marks a conversation that got a message while another was open", async () => {
    setup();
    await conversations();

    push({ deviceId: "b", app: "com.parcels", body: "Second parcel" });

    const row = await rowOf("com.parcels");
    expect(within(row).getByLabelText("1 unread")).toBeInTheDocument();
    expect(
      within(await rowOf("NORTHWIND")).queryByLabelText(/unread/),
    ).toBeNull();
  });

  it("does not count a message that lands in the open conversation", async () => {
    setup();
    await conversations();

    push({
      deviceId: "a",
      type: "sms",
      app: "sms",
      sender: "NORTHWIND",
      body: "One more",
    });

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    await within(thread).findByText("One more");
    expect(
      within(await rowOf("NORTHWIND")).queryByLabelText(/unread/),
    ).toBeNull();
  });

  it("clears the mark when the conversation is opened", async () => {
    const user = userEvent.setup();
    setup();
    await conversations();
    push({ deviceId: "b", app: "com.parcels", body: "Second parcel" });

    await user.click(await rowOf("com.parcels"));

    expect(
      within(await rowOf("com.parcels")).queryByLabelText(/unread/),
    ).toBeNull();
  });

  it("keeps the open thread when a message starts a new conversation", async () => {
    setup();
    await screen.findByRole("region", { name: "NORTHWIND" });

    push({ deviceId: "a", app: "com.new", body: "Hello from a new app" });

    const rows = (await conversations()).getAllByRole("button");
    await within(rows[0]).findByText("Hello from a new app");
    expect(
      screen.getByRole("region", { name: "NORTHWIND" }),
    ).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText("1 unread")).toBeInTheDocument();
  });

  it("adds the unread messages up on the phone and on All phones", async () => {
    setup();
    await conversations();

    push({ deviceId: "b", app: "com.parcels", body: "Two" });
    push({ deviceId: "b", app: "com.other", body: "Three" });

    const nav = within(phonesNav());
    const spare = await nav.findByRole("button", { name: /spare phone/i });
    expect(within(spare).getByLabelText("2 unread")).toBeInTheDocument();
    expect(
      within(nav.getByRole("button", { name: /all phones/i })).getByLabelText(
        "2 unread",
      ),
    ).toBeInTheDocument();
  });
});

describe("long messages", () => {
  const longBody = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );

  function open(body) {
    mockApi({
      devices: phones,
      messages: [
        message({
          deviceId: "a",
          type: "sms",
          app: "sms",
          sender: "NORTHWIND",
          body,
        }),
      ],
    });
    render(<Dashboard username="admin" onLogout={() => {}} />);
    return screen.findByRole("region", { name: "NORTHWIND" });
  }

  it("folds a message with many lines behind a Show more button", async () => {
    const thread = await open(longBody);

    const button = within(thread).getByRole("button", { name: "Show more" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Folded by the page, not cut: the whole text is still in it.
    expect(thread).toHaveTextContent("line 20");
  });

  it("folds one very long line too", async () => {
    const thread = await open("word ".repeat(200));

    expect(
      within(thread).getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });

  it("shows all of it on Show more, and folds it again on Show less", async () => {
    const user = userEvent.setup();
    const thread = await open(longBody);

    await user.click(within(thread).getByRole("button", { name: "Show more" }));
    const less = within(thread).getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");

    await user.click(less);
    expect(
      within(thread).getByRole("button", { name: "Show more" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves a short message alone", async () => {
    const thread = await open("Just a short text");

    expect(within(thread).queryByRole("button", { name: /show/i })).toBeNull();
  });
});

describe("kind badge", () => {
  it("tells an SMS conversation from an app one in the list", async () => {
    setup();

    const rows = (await conversations()).getAllByRole("button");
    expect(within(rows[0]).getByText("SMS")).toBeInTheDocument();
    expect(within(rows[1]).getByText("App")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("App")).toBeNull();
  });

  it("tags every message in the thread with it", async () => {
    setup();

    const thread = await screen.findByRole("region", { name: "NORTHWIND" });
    const articles = within(thread).getAllByRole("article");
    expect(articles).toHaveLength(2);
    for (const article of articles)
      expect(within(article).getByText("SMS")).toBeInTheDocument();
  });

  it("shows it in the thread header too", async () => {
    const user = userEvent.setup();
    setup();

    const sms = await screen.findByRole("region", { name: "NORTHWIND" });
    expect(
      within(within(sms).getByRole("banner")).getByText("SMS"),
    ).toBeInTheDocument();

    await user.click(
      (await conversations()).getByRole("button", { name: /com\.parcels/ }),
    );
    const app = screen.getByRole("region", { name: "com.parcels" });
    expect(
      within(within(app).getByRole("banner")).getByText("App"),
    ).toBeInTheDocument();
  });
});
