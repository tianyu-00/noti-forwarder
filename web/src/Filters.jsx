import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import * as Tabs from '@radix-ui/react-tabs';

const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'sms', label: 'SMS' },
  { value: 'notification', label: 'Notifications' },
];

const SEARCH_DEBOUNCE_MS = 250;

export default function Filters({ filters, apps, onChange }) {
  const [text, setText] = useState(filters.q);

  // Debounce typing so each keystroke does not trigger a request.
  useEffect(() => {
    if (text === filters.q) return undefined;
    const timer = setTimeout(() => onChange({ ...filters, q: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, filters, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <Tabs.Root
        value={filters.type || 'all'}
        onValueChange={(v) => onChange({ ...filters, type: v === 'all' ? '' : v })}
      >
        <Tabs.List aria-label="Message type" className="flex rounded bg-slate-800 p-1 text-sm">
          {TYPES.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="rounded px-3 py-1 data-[state=active]:bg-sky-600 data-[state=active]:text-white"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      <select
        aria-label="App"
        value={filters.app}
        onChange={(e) => onChange({ ...filters, app: e.target.value })}
        className="rounded bg-slate-800 p-2 text-sm"
      >
        <option value="">All apps</option>
        {apps.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Search"
        placeholder="Search messages"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-w-0 flex-1 rounded bg-slate-800 p-2 text-sm"
      />
    </div>
  );
}

Filters.propTypes = {
  filters: PropTypes.shape({
    type: PropTypes.string.isRequired,
    app: PropTypes.string.isRequired,
    q: PropTypes.string.isRequired,
  }).isRequired,
  apps: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
};
