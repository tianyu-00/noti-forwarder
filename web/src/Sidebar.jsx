import PropTypes from 'prop-types';
import clsx from 'clsx';
import { formatQuiet, isOnline, timeAgo } from './time.js';

export const deviceShape = PropTypes.shape({
  deviceId: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  pairedAt: PropTypes.string,
  lastSeen: PropTypes.string,
  revokedAt: PropTypes.string,
});

// A phone that has not checked in for silentAfterMinutes is "quiet": its messages may have
// stopped (app killed, no network, Notification access off). 0 turns the label off.
function quietFor(device, silentAfterMinutes, now) {
  if (device.revokedAt || !silentAfterMinutes) return null;
  const since = new Date(device.lastSeen ?? device.pairedAt).getTime();
  return Number.isNaN(since) || now - since < silentAfterMinutes * 60000 ? null : now - since;
}

function status(device, silentAfterMinutes, now) {
  if (device.revokedAt) return 'Revoked';
  const quiet = quietFor(device, silentAfterMinutes, now);
  if (quiet !== null) return `Quiet for ${formatQuiet(quiet)}`;
  if (!device.lastSeen) return 'Never connected';
  return isOnline(device.lastSeen, now) ? 'Online' : `Last seen ${timeAgo(device.lastSeen, now)}`;
}

function Item({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex shrink-0 flex-col gap-0.5 rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-raised md:w-full md:border-transparent',
        active && 'border-fg bg-raised md:border-transparent',
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

export default function Sidebar({ devices, selected, unread, onSelect, silentAfterMinutes = 0, now }) {
  return (
    <nav aria-label="Phones" className="flex w-full gap-2 overflow-x-auto p-3 md:block md:w-64 md:space-y-0.5 md:overflow-visible">
      <Item active={selected === null} onClick={() => onSelect(null)}>
        <span className="font-medium text-fg">All phones</span>
      </Item>
      {devices.map((d) => (
        <Item key={d.deviceId} active={selected === d.deviceId} onClick={() => onSelect(d.deviceId)}>
          <span className="flex items-center justify-between gap-2 font-medium text-fg">
            {d.name}
            {unread[d.deviceId] > 0 && (
              <span aria-label={`${unread[d.deviceId]} unread`} className="rounded-full bg-primary px-2 text-xs font-medium text-on-primary">
                {unread[d.deviceId]}
              </span>
            )}
          </span>
          <span
            className={clsx(
              'text-xs',
              quietFor(d, silentAfterMinutes, now) !== null
                ? 'font-medium text-danger'
                : isOnline(d.lastSeen, now) && !d.revokedAt
                  ? 'text-ok'
                  : 'text-muted',
            )}
          >
            {status(d, silentAfterMinutes, now)}
          </span>
        </Item>
      ))}
    </nav>
  );
}

Sidebar.propTypes = {
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  selected: PropTypes.string,
  unread: PropTypes.objectOf(PropTypes.number).isRequired,
  onSelect: PropTypes.func.isRequired,
  silentAfterMinutes: PropTypes.number,
  now: PropTypes.number.isRequired,
};
