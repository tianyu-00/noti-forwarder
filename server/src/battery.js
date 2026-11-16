// Tells receivers when a sender phone's battery gets low, and when it has recovered. A phone running out of
// battery stops forwarding, which is the same kind of silent failure as a quiet phone.
//
// Low: 15% or less and not charging. Recovered: plugged in, or back to 20% or more. Between the two the phone
// stays "low" without saying anything more, so a level hovering around the limit does not repeat itself.
// Which phones were announced is kept in memory only (no database column): after a server restart a phone that is
// still low is announced once more. Nothing here handles message text.

const LOW_AT = 15;
const OK_AT = 20;

export function createBatteryWatcher({
  // Called with { deviceId, deviceName, percent }.
  onLow = () => {},
  onOk = () => {},
  logger = console,
} = {}) {
  const low = new Set();

  // A broken listener must not stop the request that reported the level.
  function tell(listener, event) {
    try {
      listener(event);
    } catch {
      logger.warn('battery announcement failed');
    }
  }

  return {
    observe({ deviceId, deviceName, percent, charging }) {
      if (!low.has(deviceId)) {
        if (percent <= LOW_AT && !charging) {
          low.add(deviceId);
          tell(onLow, { deviceId, deviceName, percent });
        }
      } else if (charging || percent >= OK_AT) {
        low.delete(deviceId);
        tell(onOk, { deviceId, deviceName, percent });
      }
    },
    forget(deviceId) {
      low.delete(deviceId);
    },
  };
}
