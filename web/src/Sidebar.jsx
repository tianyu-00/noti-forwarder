import PropTypes from 'prop-types';
import clsx from 'clsx';
import { isOnline, timeAgo } from './time.js';

export const deviceShape = PropTypes.shape({
  deviceId: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  lastSeen: PropTypes.string,
  revokedAt: PropTypes.string,
});

function status(device) {
  if (device.revokedAt) return 'Revoked';
  if (!device.lastSeen) return 'Never connected';
  return isOnline(device.lastSeen) ? 'Online' : `Last seen ${timeAgo(device.lastSeen)}`;
}

function Item({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex w-full flex-col rounded px-3 py-2 text-left text-sm hover:bg-slate-800',
        active && 'bg-slate-800',
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

export default function Sidebar({ devices, selected, onSelect }) {
  return (
    <nav aria-label="Phones" className="w-full space-y-1 p-2 md:w-64">
      <Item active={selected === null} onClick={() => onSelect(null)}>
        <span className="font-medium">All phones</span>
      </Item>
      {devices.map((d) => (
        <Item key={d.deviceId} active={selected === d.deviceId} onClick={() => onSelect(d.deviceId)}>
          <span className="font-medium">{d.name}</span>
          <span className={clsx('text-xs', isOnline(d.lastSeen) && !d.revokedAt ? 'text-emerald-400' : 'text-slate-400')}>
            {status(d)}
          </span>
        </Item>
      ))}
    </nav>
  );
}

Sidebar.propTypes = {
  devices: PropTypes.arrayOf(deviceShape).isRequired,
  selected: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
};
