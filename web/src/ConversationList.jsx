import PropTypes from "prop-types";
import clsx from "clsx";
import { timeAgo } from "./time.js";

function preview(m) {
  if (m.locked) return "Encrypted message";
  return m.body;
}

export default function ConversationList({
  conversations,
  deviceNames,
  openId,
  onOpen,
  unread = {},
  now,
}) {
  if (conversations.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">
        No messages yet.
      </p>
    );
  }
  return (
    <ul aria-label="Conversations" className="divide-y divide-line">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onOpen(c.id)}
            aria-current={c.id === openId ? "true" : undefined}
            className={clsx(
              "flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-raised",
              c.id === openId && "bg-raised",
            )}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-semibold">{c.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {timeAgo(c.latest.receivedAt, now)}
              </span>
            </span>
            <span className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-muted">
                {preview(c.latest)}
              </span>
              {unread[c.id] > 0 && (
                <span
                  aria-label={`${unread[c.id]} unread`}
                  className="shrink-0 rounded-full bg-accent px-2 text-xs font-semibold text-on-accent"
                >
                  {unread[c.id]}
                </span>
              )}
            </span>
            <span className="text-xs text-faint">
              {deviceNames[c.deviceId] ?? "Unknown phone"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

ConversationList.propTypes = {
  conversations: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      deviceId: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      latest: PropTypes.object.isRequired,
    }),
  ).isRequired,
  deviceNames: PropTypes.objectOf(PropTypes.string).isRequired,
  openId: PropTypes.string,
  onOpen: PropTypes.func.isRequired,
  unread: PropTypes.objectOf(PropTypes.number),
  now: PropTypes.number.isRequired,
};
