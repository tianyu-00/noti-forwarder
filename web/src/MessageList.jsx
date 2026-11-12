import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { splitAroundCode } from './code.js';
import { Button } from './ui.jsx';

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
  // Browsers only allow clipboard access on HTTPS pages (and localhost).
  const insecure = window.isSecureContext === false;

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
      <Button onClick={copy} disabled={insecure} className="px-3 py-1.5 text-xs">
        {state === 'copied' ? 'Copied' : 'Copy code'}
      </Button>
      {insecure && <span className="text-xs text-muted">Copying only works over HTTPS. Select the code instead.</span>}
      {state === 'failed' && <span className="text-xs text-danger">Could not copy. Select the code instead.</span>}
    </span>
  );
}

CopyCodeButton.propTypes = { code: PropTypes.string.isRequired };

export default function MessageList({ messages, deviceNames }) {
  if (messages.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted">No messages yet.</p>;
  }
  return (
    <ul className="divide-y divide-line border-t border-line">
      {messages.map((m) => (
        <li key={m.id}>
          <article className="space-y-2 px-4 py-4">
            <div className="flex items-baseline justify-between gap-4">
              {m.sender ? <p className="text-sm font-semibold text-fg">{m.sender}</p> : <span />}
              <time dateTime={m.receivedAt} className="shrink-0 text-xs text-muted">
                {new Date(m.receivedAt).toLocaleString()}
              </time>
            </div>
            <p className="flex flex-wrap gap-x-1.5 text-xs text-muted">
              <span>{deviceNames[m.deviceId] ?? 'Unknown phone'}</span>
              <span aria-hidden="true">·</span>
              <span>{m.type === 'sms' ? 'SMS' : m.app}</span>
            </p>
            {/* Plain text only: message content is untrusted. The code is a slice of that text. */}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
              {splitAroundCode(m.body, m.code).map((part, i) =>
                part.isCode ? (
                  <mark key={i} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.95em] font-semibold text-fg ring-1 ring-line">
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
