import PropTypes from 'prop-types';

export const messageShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  deviceId: PropTypes.string.isRequired,
  type: PropTypes.string.isRequired,
  app: PropTypes.string.isRequired,
  sender: PropTypes.string,
  body: PropTypes.string.isRequired,
  receivedAt: PropTypes.string.isRequired,
});

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
            {/* Plain text only: message content is untrusted. */}
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{m.body}</p>
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
