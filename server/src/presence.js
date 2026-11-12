// Who is connected right now. A phone holds one long-lived connection to the server (like the
// dashboard's live stream), so "connected" is exact and a dropped connection shows within
// seconds. Held in memory only: a server restart drops every connection, and phones reconnect.
//
// A connection is { send(event, data), close() }. One per phone: a new one replaces the old,
// because a phone that changed network leaves a dead socket behind that the server only
// notices much later.
export function createPresence({ onChange = () => {} } = {}) {
  const connections = new Map(); // deviceId -> connection

  function connect(deviceId, connection) {
    const previous = connections.get(deviceId);
    connections.set(deviceId, connection);
    if (previous) previous.close();
    else onChange(deviceId, true);

    // Only the connection that is still current may mark the phone offline.
    return function release() {
      if (connections.get(deviceId) !== connection) return;
      connections.delete(deviceId);
      onChange(deviceId, false);
    };
  }

  return {
    connect,
    isConnected: (deviceId) => connections.has(deviceId),
    connectedIds: () => [...connections.keys()],
    /** The phone was revoked or unpaired: tell it, then hang up. */
    revoke(deviceId) {
      const connection = connections.get(deviceId);
      if (!connection) return;
      connections.delete(deviceId);
      connection.send('revoked', {});
      connection.close();
      onChange(deviceId, false);
    },
  };
}
