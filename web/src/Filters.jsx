import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import * as Tabs from '@radix-ui/react-tabs';
import { fieldClass } from './ui.jsx';

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
    <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
      <Tabs.Root
        value={filters.type || 'all'}
        onValueChange={(v) => onChange({ ...filters, type: v === 'all' ? '' : v })}
      >
        <Tabs.List aria-label="Message type" className="flex rounded-md border border-line p-0.5 text-sm">
          {TYPES.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="rounded px-3 py-1.5 font-medium text-muted hover:text-fg data-[state=active]:bg-primary data-[state=active]:text-on-primary"
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
        className={fieldClass}
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
        className={`${fieldClass} min-w-40 flex-1`}
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
