import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { splitAroundCode } from "./code.js";
import { Button } from "./ui.jsx";

const messageShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  deviceId: PropTypes.string.isRequired,
  type: PropTypes.string.isRequired,
  app: PropTypes.string.isRequired,
  sender: PropTypes.string,
  body: PropTypes.string.isRequired,
  receivedAt: PropTypes.string.isRequired,
  // The one-time (2FA) code found in the text, digits only, or null.
  code: PropTypes.string,
  // Set by the dashboard when an encrypted message cannot be shown: 'no-key' or 'wrong-key'.
  locked: PropTypes.string,
});

// Browsers only offer the clipboard API on HTTPS pages (and localhost). On plain http the old
// way still works: put the text in a hidden field, select it and run the copy command.
function copyWithTextField(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

async function copyText(text) {
  if (window.isSecureContext !== false && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (!copyWithTextField(text)) throw new Error("copy refused");
}

function CopyCodeButton({ code }) {
  const [state, setState] = useState("idle"); // idle | copied | failed

  // Go back to "Copy code" after a moment.
  useEffect(() => {
    if (state === "idle") return undefined;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await copyText(code);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={copy} className="px-3 py-1.5 text-xs">
        {state === "copied" ? "Copied" : "Copy code"}
      </Button>
      {state === "failed" && (
        <span className="text-xs text-danger">
          Could not copy. Select the code instead.
        </span>
      )}
    </span>
  );
}

CopyCodeButton.propTypes = { code: PropTypes.string.isRequired };

const dayFormat = { day: "numeric", month: "short", year: "numeric" };

function dayLabel(iso) {
  const day = new Date(iso);
  return day.toDateString() === new Date().toDateString()
    ? "Today"
    : day.toLocaleDateString(undefined, dayFormat);
}

function Bubble({ message: m }) {
  return (
    <article className="max-w-[min(34rem,100%)] space-y-1.5 self-start">
      <div className="rounded-2xl rounded-tl-sm border border-line bg-bg px-4 py-3">
        {/* An SMS sender is the conversation itself; a notification's title changes each time. */}
        {m.type === "notification" && m.sender && (
          <p className="mb-1 text-sm font-semibold text-fg">{m.sender}</p>
        )}
        {/* Plain text only: message content is untrusted. The code is a slice of that text. */}
        {m.locked ? (
          <p className="text-sm italic text-muted">
            {m.locked === "no-key"
              ? "Encrypted message. Add the encryption key in Settings to read it."
              : "Could not decrypt this message. It was probably encrypted with a different key."}
          </p>
        ) : (
          <p className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-fg">
            {splitAroundCode(m.body, m.code).map((part, i) =>
              part.isCode ? (
                <mark
                  key={i}
                  className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.95em] font-semibold text-fg ring-1 ring-line"
                >
                  {part.text}
                </mark>
              ) : (
                part.text
              ),
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 px-1">
        <time dateTime={m.receivedAt} className="text-xs text-muted">
          {new Date(m.receivedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        {m.code && <CopyCodeButton code={m.code} />}
      </div>
    </article>
  );
}

Bubble.propTypes = { message: messageShape.isRequired };

/** One conversation: a header, its messages oldest first, and a reply box that is not live yet. */
export default function Thread({ conversation, deviceName, onBack, actions }) {
  const oldestFirst = [...conversation.messages].reverse();
  return (
    <section
      aria-label={conversation.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack && (
            <Button
              variant="ghost"
              onClick={onBack}
              aria-label="Back to conversations"
              className="md:hidden"
            >
              ←
            </Button>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {conversation.name}
            </h2>
            <p className="text-xs text-muted">
              {conversation.type === "sms" ? "SMS" : "Notifications"} ·{" "}
              {deviceName ?? "Unknown phone"}
            </p>
          </div>
        </div>
        {actions}
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-surface px-4 py-5">
        {oldestFirst.map((m, i) => {
          const day = dayLabel(m.receivedAt);
          const startsDay =
            i === 0 || day !== dayLabel(oldestFirst[i - 1].receivedAt);
          return (
            <div key={m.id} className="flex flex-col gap-3">
              {startsDay && (
                <p className="self-center rounded-full bg-raised px-3 py-1 text-xs text-muted">
                  {day}
                </p>
              )}
              <Bubble message={m} />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <input
          type="text"
          disabled
          aria-label="Reply"
          placeholder="Replying from this PC is not available yet"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm placeholder:text-faint"
        />
        <Button disabled aria-label="Send reply" className="rounded-full">
          →
        </Button>
      </div>
    </section>
  );
}

Thread.propTypes = {
  conversation: PropTypes.shape({
    name: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    messages: PropTypes.arrayOf(messageShape).isRequired,
  }).isRequired,
  deviceName: PropTypes.string,
  // Set only on a narrow screen, where the list and the thread take turns.
  onBack: PropTypes.func,
  actions: PropTypes.node,
};
