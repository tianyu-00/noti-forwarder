import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { splitAroundCode } from './code.js';

export const messageShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  deviceId: PropTypes.string.isRequired,
  type: PropTypes.string.isRequired,
  app: PropTypes.string.isRequired,
  sender: PropTypes.string,
  body: PropTypes.string.isRequired,
  receivedAt: PropTypes.string.isRequired,
  // The one-time (2FA) code found in the text, digits only, or null.
  code: PropTypes.string,
});

function CopyCodeButton({ code }) {
  const [state, setState] = useState('idle'); // idle | copied | failed

  // Go back to "Copy code" after a moment.
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-sky-500"
      >
        {state === 'copied' ? 'Copied' : 'Copy code'}
      </button>
      {state === 'failed' && <span className="text-xs text-amber-400">Could not copy. Select the code instead.</span>}
    </span>
  );
}

CopyCodeButton.propTypes = { code: PropTypes.string.isRequired };

export default function MessageList({ messages, deviceNames }) {
  if (messages.length === 0) {
    return <p className="p-6 text-slate-400">No messages yet.</p>;
  }
  return (
    <ul className="divide-y divide-slate-800">
      {messages.map((m) => (
        <li key={m.id}>
          <article className="space-y-1 p-4">
            <header className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-400">
              <span className="font-medium text-slate-200">{deviceNames[m.deviceId] ?? 'Unknown phone'}</span>
              <span>{m.type === 'sms' ? 'SMS' : m.app}</span>
              <time dateTime={m.receivedAt}>{new Date(m.receivedAt).toLocaleString()}</time>
            </header>
            {m.sender && <p className="text-sm font-semibold text-slate-100">{m.sender}</p>}
            {/* Plain text only: message content is untrusted. The code is a slice of that text. */}
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
              {splitAroundCode(m.body, m.code).map((part, i) =>
                part.isCode ? (
                  <mark key={i} className="rounded bg-sky-500/20 px-1 font-mono text-base text-sky-200">
                    {part.text}
                  </mark>
                ) : (
                  part.text
                ),
              )}
            </p>
            {m.code && <CopyCodeButton code={m.code} />}
          </article>
        </li>
      ))}
    </ul>
  );
}

MessageList.propTypes = {
  messages: PropTypes.arrayOf(messageShape).isRequired,
  deviceNames: PropTypes.objectOf(PropTypes.string).isRequired,
};
