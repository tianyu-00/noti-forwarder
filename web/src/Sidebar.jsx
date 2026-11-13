import PropTypes from "prop-types";
import clsx from "clsx";
import { formatQuiet, timeAgo } from "./time.js";

export const deviceShape = PropTypes.shape({
  deviceId: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  pairedAt: PropTypes.string,
  lastSeen: PropTypes.string,
  // True while the phone holds its connection to the server.
  connected: PropTypes.bool,
  revokedAt: PropTypes.string,
});

// A phone that has not checked in for silentAfterMinutes is "quiet": its messages may have
// stopped (app killed, no network, Notification access off). 0 turns the label off.
function quietFor(device, silentAfterMinutes, now) {
  if (device.revokedAt || !silentAfterMinutes) return null;
  const since = new Date(device.lastSeen ?? device.pairedAt).getTime();
  return Number.isNaN(since) || now - since < silentAfterMinutes * 60000
    ? null
    : now - since;
}

// live: holds its connection to the server right now (the only thing that counts as online: a
// phone that lost its network drops off within about a minute). quiet: silent for too long.
// idle: not connected, seen a while ago. A connected phone is never quiet, however old its last
// message is.
function stateOf(device, silentAfterMinutes, now) {
  if (device.revokedAt) return "revoked";
  if (device.connected) return "live";
  if (quietFor(device, silentAfterMinutes, now) !== null) return "quiet";
  return "idle";
}

function status(device, state, silentAfterMinutes, now) {
  if (state === "revoked") return "Revoked";
  if (state === "live") return "Online";
  if (state === "quiet")
    return `Quiet for ${formatQuiet(quietFor(device, silentAfterMinutes, now))}`;
  return device.lastSeen
    ? `Last seen ${timeAgo(device.lastSeen, now)}`
    : "Never connected";
}

const DOT_CLASS = {
  live: "status-dot-live bg-rail-accent",
  idle: "bg-rail-muted",
  quiet: "bg-rail-danger",
};

// Decorative: the words next to it carry the meaning, so screen readers skip it.
function StatusDot({ state }) {
  if (state === "revoked") return null;
  return (
    <span
      data-testid="status-dot"
      data-state={state}
      aria-hidden="true"
      className={clsx("h-2 w-2 shrink-0 rounded-full", DOT_CLASS[state])}
    />
  );
}

StatusDot.propTypes = { state: PropTypes.string.isRequired };

function Item({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex shrink-0 flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left text-sm text-rail-fg hover:bg-rail-active/60 md:w-full",
        active && "bg-rail-active",
      )}
    >
      {children}
    </button>
  );
}

Item.propTypes = {
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

function StatusRow({ device, silentAfterMinutes, now }) {
  const state = stateOf(device, silentAfterMinutes, now);
  const tone =
    { live: "text-rail-accent", quiet: "font-medium text-rail-danger" }[
      state
    ] ?? "text-rail-muted";
  return (
    <span className={clsx("flex items-center gap-1.5 text-xs", tone)}>
      <StatusDot state={state} />
      {status(device, state, silentAfterMinutes, now)}
    </span>
  );
}

StatusRow.propTypes = {
  device: deviceShape.isRequired,
  silentAfterMinutes: PropTypes.number.isRequired,
  now: PropTypes.number.isRequired,
};

export default function Sidebar({
  devices,
  selected,
  unread,
  unreadTotal = 0,
  onSelect,
  silentAfterMinutes = 0,
  now,
}) {
  return (
    <nav
      aria-label="Phones"
      className="flex w-full gap-2 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible"
    >
      <Item active={selected === null} onClick={() => onSelect(null)}>
        <span className="flex items-center justify-between gap-2 font-medium">
          All phones
          {unreadTotal > 0 && (
            <span
              aria-label={`${unreadTotal} unread`}
              className="rounded-full bg-rail-accent px-2 text-xs font-bold text-on-rail-accent"
            >
              {unreadTotal}
            </span>
          )}
        </span>
      </Item>
      {devices.map((d) => (
        <Item
          key={d.deviceId}
          active={selected === d.deviceId}
          onClick={() => onSelect(d.deviceId)}
        >
          <span className="flex items-center justify-between gap-2 font-medium">
            {d.name}
            {unread[d.deviceId] > 0 && (
              <span
                aria-label={`${unread[d.deviceId]} unread`}
                className="rounded-full bg-rail-accent px-2 text-xs font-bold text-on-rail-accent"
              >
                {unread[d.deviceId]}
              </span>
            )}
          </span>
          <StatusRow
            device={d}
            silentAfterMinutes={silentAfterMinutes}
            now={now}
          />
        </Item>
      ))}
    </nav>
  );
}

Sidebar.propTypes = {
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  selected: PropTypes.string,
  unread: PropTypes.objectOf(PropTypes.number).isRequired,
  // Unread messages across all phones, shown on "All phones".
  unreadTotal: PropTypes.number,
  onSelect: PropTypes.func.isRequired,
  silentAfterMinutes: PropTypes.number,
  now: PropTypes.number.isRequired,
};
