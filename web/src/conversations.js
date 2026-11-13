// Turns a flat list of messages (newest first) into conversations: one per phone and sender.
// An SMS belongs to the number or name it came from; a notification to the app that posted it,
// because its title changes with every message.
export function conversationKey(m) {
  const who = m.type === "sms" ? (m.sender ?? "") : m.app;
  return JSON.stringify([m.deviceId, m.type, who]);
}

/** The phone a conversation id (from conversationKey) belongs to. */
export function conversationDevice(id) {
  return JSON.parse(id)[0];
}

function conversationName(m) {
  if (m.type === "sms") return m.sender || "Unknown sender";
  return m.app;
}

export function groupConversations(messages) {
  const byKey = new Map();
  for (const m of messages) {
    const key = conversationKey(m);
    let conversation = byKey.get(key);
    if (!conversation) {
      // Messages come newest first, so the first one seen is the latest.
      conversation = {
        id: key,
        deviceId: m.deviceId,
        type: m.type,
        name: conversationName(m),
        latest: m,
        messages: [],
      };
      byKey.set(key, conversation);
    }
    conversation.messages.push(m);
  }
  // Map keeps insertion order, which is already newest conversation first.
  return [...byKey.values()];
}
