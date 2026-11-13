import PropTypes from "prop-types";

/** Small tag saying whether a conversation is a text message or an app's notifications. */
export default function KindBadge({ type }) {
  const sms = type === "sms";
  // Two tints from the avatar palette: green for texts, blue for apps. Neither matches the
  // grey of the open row, so both stay readable on it.
  const tone = sms ? "var(--accent-soft)" : "var(--av1-bg)";
  const ink = sms ? "var(--accent-ink)" : "var(--av1-fg)";
  return (
    <span
      style={{ background: tone, color: ink }}
      className="inline-block rounded-full px-2 py-px text-[11px] font-semibold"
    >
      {sms ? "SMS" : "App"}
    </span>
  );
}

KindBadge.propTypes = { type: PropTypes.string.isRequired };
