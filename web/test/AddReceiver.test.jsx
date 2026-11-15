import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import Dashboard from "../src/Dashboard.jsx";
import { device, mockApi } from "./fixtures.js";
import { server } from "./server.js";

// The main phone is a "receiver": it shows your alerts. It is added the same way as a sender, from "Add phone".
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
const pairing = (code) => ({
  code,
  expiresAt: inMinutes(10),
  qrPayload: JSON.stringify({ u: "https://nf.example.com", c: code }),
});

// Collects what the page asks for when it makes a pairing code.
function mockCodes() {
  const asked = [];
  server.use(
    http.post("/api/v1/pairing-codes", async ({ request }) => {
      const body = await request.json().catch(() => ({}));
      asked.push(body);
      return HttpResponse.json(
        pairing(
          body.role === "receiver" ? "RECEIVER-CODE-1234" : "SENDER-CODE-1234",
        ),
        { status: 201 },
      );
    }),
  );
  return asked;
}

async function openDialog() {
  const user = userEvent.setup();
  render(<Dashboard username="admin" onLogout={() => {}} />);
  await user.click(await screen.findByRole("button", { name: /add phone/i }));
  return {
    user,
    dialog: await screen.findByRole("dialog", { name: /add phone/i }),
  };
}

describe("adding a phone as a sender or a receiver", () => {
  it("offers a sender code first, and says what a sender is", async () => {
    mockApi({});
    const asked = mockCodes();

    const { dialog } = await openDialog();

    expect(
      await within(dialog).findByText("SENDER-CODE-1234"),
    ).toBeInTheDocument();
    expect(asked).toEqual([{ role: "sender" }]);
    expect(
      within(dialog).getByRole("radio", { name: /sender/i }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: /receiver/i }),
    ).not.toBeChecked();
  });

  it("makes a new code for a receiver when Receiver is chosen, and explains it is for the main phone", async () => {
    mockApi({});
    const asked = mockCodes();
    const { user, dialog } = await openDialog();
    await within(dialog).findByText("SENDER-CODE-1234");

    await user.click(within(dialog).getByRole("radio", { name: /receiver/i }));

    expect(
      await within(dialog).findByText("RECEIVER-CODE-1234"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("SENDER-CODE-1234")).toBeNull();
    expect(asked).toEqual([{ role: "sender" }, { role: "receiver" }]);
    expect(dialog).toHaveTextContent(/main phone/i);
  });

  it("can go back to a sender code", async () => {
    mockApi({});
    const asked = mockCodes();
    const { user, dialog } = await openDialog();
    await within(dialog).findByText("SENDER-CODE-1234");
    await user.click(within(dialog).getByRole("radio", { name: /receiver/i }));
    await within(dialog).findByText("RECEIVER-CODE-1234");

    await user.click(within(dialog).getByRole("radio", { name: /sender/i }));

    expect(
      await within(dialog).findByText("SENDER-CODE-1234"),
    ).toBeInTheDocument();
    expect(asked.at(-1)).toEqual({ role: "sender" });
  });
});

describe("telling receivers from senders in the phone list", () => {
  it("labels a receiver, and leaves senders unlabelled", async () => {
    mockApi({
      devices: [
        device({ deviceId: "s", name: "Kitchen phone", role: "sender" }),
        device({ deviceId: "r", name: "My main phone", role: "receiver" }),
      ],
    });
    render(<Dashboard username="admin" onLogout={() => {}} />);

    const nav = await screen.findByRole("navigation", { name: "Phones" });

    expect(await within(nav).findByText("Receiver")).toBeInTheDocument();
    expect(within(nav).getAllByText("Receiver")).toHaveLength(1);
  });
});
