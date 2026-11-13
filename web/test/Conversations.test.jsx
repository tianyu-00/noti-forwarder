import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "../src/Dashboard.jsx";
import { device, message, mockApi } from "./fixtures.js";

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
