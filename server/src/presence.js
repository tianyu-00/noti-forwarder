// Who is connected right now. A phone holds one long-lived connection to the server (like the
// dashboard's live stream), so "connected" is exact and a dropped connection shows within
// seconds. Held in memory only: a server restart drops every connection, and phones reconnect.
//
// A connection is { send(event, data), close() }. One per phone: a new one replaces the old,
// because a phone that changed network leaves a dead socket behind that the server only
// notices much later.
export function createPresence({ onChange = () => {}, now = Date.now } = {}) {
  const connections = new Map(); // deviceId -> connection
  const lastHeard = new Map(); // deviceId -> when the phone last proved it was alive

  function connect(deviceId, connection) {
    const previous = connections.get(deviceId);
    connections.set(deviceId, connection);
    lastHeard.set(deviceId, now());
    if (previous) previous.close();
    else onChange(deviceId, true);

    // Only the connection that is still current may mark the phone offline.
    return function release() {
      if (connections.get(deviceId) !== connection) return;
      connections.delete(deviceId);
      lastHeard.delete(deviceId);
      onChange(deviceId, false);
    };
  }

  return {
    connect,
    isConnected: (deviceId) => connections.has(deviceId),
    connectedIds: () => [...connections.keys()],
    /**
     * The phone proved it is alive (it sends a small check-in while connected). A phone that
     * loses its network never closes the connection, and the server cannot tell from its side
     * for many minutes, so silence is the only signal.
     */
    touch(deviceId) {
      if (connections.has(deviceId)) lastHeard.set(deviceId, now());
    },
    /** Hangs up on connections not heard from for maxSilenceMs. Returns the phones dropped. */
    dropStale(maxSilenceMs) {
      const dropped = [];
      for (const [deviceId, connection] of [...connections]) {
        if (now() - (lastHeard.get(deviceId) ?? 0) <= maxSilenceMs) continue;
        connections.delete(deviceId);
        lastHeard.delete(deviceId);
        connection.close();
        onChange(deviceId, false);
        dropped.push(deviceId);
      }
      return dropped;
    },
    /** The phone was revoked or unpaired: tell it, then hang up. */
    revoke(deviceId) {
      const connection = connections.get(deviceId);
      if (!connection) return;
      connections.delete(deviceId);
      lastHeard.delete(deviceId);
      connection.send('revoked', {});
      connection.close();
      onChange(deviceId, false);
    },
  };
}
