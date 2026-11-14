import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import clsx from "clsx";
import { splitAroundCode } from "./code.js";
import { Button } from "./ui.jsx";
import Avatar from "./Avatar.jsx";
import KindBadge from "./KindBadge.jsx";
import { defaultSim, simLabel } from "./sims.js";

const messageShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  deviceId: PropTypes.string.isRequired,
  type: PropTypes.string.isRequired,
  app: PropTypes.string.isRequired,
  sender: PropTypes.string,
  body: PropTypes.string.isRequired,
  receivedAt: PropTypes.string.isRequired,
  // The app's real name as the phone shows it, or null.
  appLabel: PropTypes.string,
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
      <button
        type="button"
        onClick={copy}
        className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent hover:opacity-90"
      >
        {state === "copied" ? "Copied" : "Copy code"}
      </button>
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

// Longer than this and a message is folded: an email notification can run to dozens of lines.
const FOLD_LINES = 8;
const FOLD_CHARS = 600;
const isLong = (body) =>
  body.length > FOLD_CHARS || body.split("\n").length > FOLD_LINES;

function Bubble({ message: m }) {
  const [expanded, setExpanded] = useState(false);
  const foldable = !m.locked && isLong(m.body);
  return (
    <article className="max-w-[min(34rem,100%)] space-y-1.5 self-start">
      <div className="rounded-2xl rounded-tl-md border border-line bg-bg px-4 py-3">
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
          <p
            className={clsx(
              "whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-fg",
              foldable && !expanded && "line-clamp-8",
            )}
          >
            {splitAroundCode(m.body, m.code).map((part, i) =>
              part.isCode ? (
                <mark
                  key={i}
                  className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[0.95em] font-bold text-accent-ink"
                >
                  {part.text}
                </mark>
              ) : (
                part.text
              ),
            )}
          </p>
        )}
        {foldable && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs font-semibold text-accent hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
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

export const simShape = PropTypes.shape({
  id: PropTypes.number.isRequired,
  slot: PropTypes.number.isRequired,
  name: PropTypes.string.isRequired,
  allowed: PropTypes.bool.isRequired,
});

const replyShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  body: PropTypes.string.isRequired,
  status: PropTypes.string.isRequired,
  error: PropTypes.string,
  createdAt: PropTypes.string.isRequired,
});

// What the phone reports when it cannot send, in plain words.
const FAILURES = {
  no_permission:
    "Allow the phone to send texts: turn on Replies in the Notiforwarder app.",
  replies_off:
    "Allow the phone to send texts: turn on Replies in the Notiforwarder app.",
  expired: "The phone was offline too long, so it was not sent.",
  no_key: "The phone does not have the encryption key for this reply.",
  practice:
    "Practice mode: the phone checked it but did not send it, so nothing was delivered.",
  choose_sim:
    "The phone has two SIMs. Choose which one to use in the Notiforwarder app.",
  sim_missing:
    "The chosen SIM is not in the phone. Choose a SIM in the Notiforwarder app.",
  sim_unknown:
    "The phone could not check the SIM. Allow phone access in the Notiforwarder app.",
  no_service: "The phone has no mobile signal.",
  radio_off: "The phone's radio is off (airplane mode?).",
  timeout: "The network did not confirm the text in time.",
  bad_number: "That does not look like a phone number the phone can text.",
  bad_message: "The phone could not read the reply.",
};

function replyStatus(reply) {
  if (reply.status === "sent") return "Sent";
  if (reply.status === "failed")
    return `Not sent. ${FAILURES[reply.error] ?? "The phone could not send it."}`;
  return "Sending…";
}

function ReplyBubble({ reply }) {
  return (
    <div
      role="group"
      aria-label="Your reply"
      data-reply-id={reply.id}
      className="max-w-[min(34rem,100%)] space-y-1.5 self-end"
    >
      <div className="rounded-2xl rounded-tr-md bg-accent px-4 py-3 text-on-accent">
        <p className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed">
          {reply.body}
        </p>
      </div>
      <p
        className={clsx(
          "px-1 text-right text-xs",
          reply.status === "failed" ? "text-danger" : "text-muted",
        )}
      >
        <time dateTime={reply.createdAt}>
          {new Date(reply.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        {" · "}
        {replyStatus(reply)}
      </p>
    </div>
  );
}

ReplyBubble.propTypes = { reply: replyShape.isRequired };

// The box under a thread. `blockedReason` is the placeholder shown while replying is not possible.
function Composer({ onSend, blockedReason, sims, receivedSim }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const blocked = blockedReason != null;
  // The phone's SIMs, when it has listed them. The user's pick counts only while the phone still allows it.
  const choosable = sims != null && sims.length > 0;
  const chosen = !choosable
    ? null
    : sims.some((s) => s.allowed && s.id === picked)
      ? picked
      : defaultSim(sims, receivedSim);
  const ready =
    !blocked && !busy && text.trim() !== "" && (!choosable || chosen != null);

  async function send() {
    if (!ready) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSend(text.trim(), chosen);
      setText("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line px-6 py-4">
      {failed && (
        <p role="alert" className="mb-2 text-sm text-danger">
          Could not send the reply. Try again.
        </p>
      )}
      <div className="flex items-end gap-3">
        {choosable && (
          <select
            aria-label="Send from SIM"
            disabled={blocked}
            value={chosen ?? ""}
            onChange={(e) => setPicked(Number(e.target.value))}
            className="h-11 max-w-[11rem] shrink-0 rounded-full border border-line bg-surface px-3 text-sm disabled:opacity-70"
          >
            {chosen == null && (
              <option value="" disabled>
                Choose a SIM
              </option>
            )}
            {sims.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.allowed}>
                {simLabel(s)}
                {s.allowed ? "" : " (not allowed on the phone)"}
              </option>
            ))}
          </select>
        )}
        <textarea
          rows={1}
          disabled={blocked}
          aria-label="Reply"
          placeholder={blocked ? blockedReason : "Write a reply"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-32 min-w-0 flex-1 resize-none rounded-3xl border border-line bg-surface px-5 py-3 text-sm [field-sizing:content] placeholder:text-faint disabled:opacity-70"
        />
        {/* A plain button, not Button: its own rounded-md would win over rounded-full. */}
        <button
          type="button"
          disabled={!ready}
          onClick={send}
          aria-label="Send reply"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

Composer.propTypes = {
  onSend: PropTypes.func.isRequired,
  blockedReason: PropTypes.string,
  sims: PropTypes.arrayOf(simShape),
  receivedSim: PropTypes.number,
};

/** One conversation: a header, its messages and replies oldest first, and a reply box. */
export default function Thread({
  conversation,
  deviceName,
  onBack,
  actions,
  replies = [],
  onReply,
  replyBlockedReason = null,
  sims = null,
}) {
  // Messages and our replies in one timeline, oldest first (a tie keeps the message first).
  const timeline = [
    ...[...conversation.messages]
      .reverse()
      .map((m) => ({ at: m.receivedAt, message: m })),
    ...replies.map((r) => ({ at: r.createdAt, reply: r })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return (
    <section
      aria-label={conversation.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
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
          <Avatar name={conversation.name} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-bold">
              {conversation.name}
            </h2>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <KindBadge type={conversation.type} />
              {deviceName ?? "Unknown phone"}
              {conversation.type === "notification" &&
                conversation.app !== conversation.name && (
                  <span className="truncate text-faint">
                    · {conversation.app}
                  </span>
                )}
            </p>
          </div>
        </div>
        {actions}
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-surface px-6 py-6">
        {timeline.map((item, i) => {
          const day = dayLabel(item.at);
          const startsDay = i === 0 || day !== dayLabel(timeline[i - 1].at);
          return (
            <div
              key={item.message?.id ?? item.reply.id}
              className="flex flex-col gap-3"
            >
              {startsDay && (
                <p className="self-center rounded-full bg-raised px-3 py-1 text-xs text-muted">
                  {day}
                </p>
              )}
              {item.message ? (
                <Bubble message={item.message} />
              ) : (
                <ReplyBubble reply={item.reply} />
              )}
            </div>
          );
        })}
      </div>
      <Composer
        key={conversation.id}
        onSend={onReply}
        blockedReason={replyBlockedReason}
        sims={sims}
        receivedSim={conversation.latest?.sim ?? undefined}
      />
    </section>
  );
}

Thread.propTypes = {
  conversation: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    app: PropTypes.string,
    messages: PropTypes.arrayOf(messageShape).isRequired,
    // The newest message; its `sim` is the SIM that received it.
    latest: PropTypes.shape({ sim: PropTypes.number }),
  }).isRequired,
  deviceName: PropTypes.string,
  // Set only on a narrow screen, where the list and the thread take turns.
  onBack: PropTypes.func,
  actions: PropTypes.node,
  // Our replies in this conversation, already readable (decrypted), oldest or newest in any order.
  replies: PropTypes.arrayOf(replyShape),
  // Sends a reply: returns a promise that rejects when it could not be queued.
  onReply: PropTypes.func.isRequired,
  // Why replying is not possible right now (shown in the box), or null when it is.
  replyBlockedReason: PropTypes.string,
  // The phone's SIMs, or null until it has listed them.
  sims: PropTypes.arrayOf(simShape),
};
