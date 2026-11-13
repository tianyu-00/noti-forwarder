import {
  conversationDevice,
  groupConversations,
} from "../src/conversations.js";
import { message } from "./fixtures.js";

// Messages arrive newest first, as the server returns them.
describe("groupConversations", () => {
  it("puts messages from the same sender on the same phone in one conversation", () => {
    const list = [
      message({
        deviceId: "a",
        type: "sms",
        app: "sms",
        sender: "NORTHWIND",
        body: "second",
        receivedAt: "2026-11-11T12:00:00.000Z",
      }),
      message({
        deviceId: "a",
        type: "sms",
        app: "sms",
        sender: "NORTHWIND",
        body: "first",
        receivedAt: "2026-11-11T11:00:00.000Z",
      }),
    ];

    const result = groupConversations(list);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("NORTHWIND");
    expect(result[0].deviceId).toBe("a");
    expect(result[0].messages.map((m) => m.body)).toEqual(["second", "first"]);
  });

  it("keeps the same sender on a different phone as a separate conversation", () => {
    const common = { type: "sms", app: "sms", sender: "NORTHWIND" };
    const result = groupConversations([
      message({ ...common, deviceId: "a" }),
      message({ ...common, deviceId: "b" }),
    ]);

    expect(result.map((c) => c.deviceId)).toEqual(["a", "b"]);
  });

  it("groups notifications by app, whatever their title says", () => {
    const common = { deviceId: "a", type: "notification", app: "com.parcels" };
    const result = groupConversations([
      message({ ...common, sender: "Out for delivery" }),
      message({ ...common, sender: "Delivered" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("com.parcels");
    expect(result[0].messages).toHaveLength(2);
  });

  it("does not mix an SMS sender with a notification app of the same name", () => {
    const result = groupConversations([
      message({ deviceId: "a", type: "sms", app: "sms", sender: "bank" }),
      message({
        deviceId: "a",
        type: "notification",
        app: "bank",
        sender: "Hi",
      }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("orders conversations by their newest message", () => {
    const result = groupConversations([
      message({
        deviceId: "a",
        app: "one",
        receivedAt: "2026-11-11T12:00:00.000Z",
      }),
      message({
        deviceId: "a",
        app: "two",
        receivedAt: "2026-11-11T11:00:00.000Z",
      }),
      message({
        deviceId: "a",
        app: "one",
        receivedAt: "2026-11-11T10:00:00.000Z",
      }),
    ]);

    expect(result.map((c) => c.name)).toEqual(["one", "two"]);
    expect(result[0].latest.receivedAt).toBe("2026-11-11T12:00:00.000Z");
  });

  it("names an SMS with no sender as unknown", () => {
    const [conversation] = groupConversations([
      message({ type: "sms", app: "sms", sender: null }),
    ]);

    expect(conversation.name).toBe("Unknown sender");
  });

  it("gives each conversation a stable id", () => {
    const m = message({ deviceId: "a", type: "sms", app: "sms", sender: "X" });
    const [first] = groupConversations([m]);
    const [again] = groupConversations([m, { ...m, id: "other" }]);

    expect(again.id).toBe(first.id);
  });

  it("returns nothing for no messages", () => {
    expect(groupConversations([])).toEqual([]);
  });
});

describe("conversationDevice", () => {
  it("tells which phone a conversation id belongs to", () => {
    const [c] = groupConversations([
      message({ deviceId: "phone-7", type: "sms", app: "sms", sender: "X" }),
    ]);

    expect(conversationDevice(c.id)).toBe("phone-7");
  });
});

describe("app names", () => {
  const gmail = {
    deviceId: "a",
    type: "notification",
    app: "com.google.android.gm",
  };

  it("names a notification conversation after the app's real name", () => {
    const [c] = groupConversations([message({ ...gmail, appLabel: "Gmail" })]);

    expect(c.name).toBe("Gmail");
    expect(c.app).toBe("com.google.android.gm");
  });

  it("finds the name on an older message when the newest has none", () => {
    const [c] = groupConversations([
      message({ ...gmail, appLabel: null }),
      message({ ...gmail, appLabel: "Gmail" }),
    ]);

    expect(c.name).toBe("Gmail");
  });

  it("keeps the package name when no message knows the app's name", () => {
    const [c] = groupConversations([message({ ...gmail, appLabel: null })]);

    expect(c.name).toBe("com.google.android.gm");
  });

  it("never renames a text conversation, which belongs to a sender", () => {
    const [c] = groupConversations([
      message({
        deviceId: "a",
        type: "sms",
        app: "sms",
        sender: "NORTHWIND",
        appLabel: "Messages",
      }),
    ]);

    expect(c.name).toBe("NORTHWIND");
  });
});
