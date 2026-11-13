import PropTypes from "prop-types";
import clsx from "clsx";

/** Small tag saying whether a conversation is a text message or an app's notifications. */
export default function KindBadge({ type }) {
  const sms = type === "sms";
  return (
    <span
      className={clsx(
        "inline-block rounded-full px-2 py-px text-[11px] font-semibold",
        sms ? "bg-accent-soft text-accent-ink" : "bg-raised text-muted",
      )}
    >
      {sms ? "SMS" : "App"}
    </span>
  );
}

KindBadge.propTypes = { type: PropTypes.string.isRequired };
