import PropTypes from "prop-types";
import { avatarInitial, avatarTone } from "./avatar.js";

export default function Avatar({ name, size = "md" }) {
  const tone = avatarTone(name);
  return (
    <span
      aria-hidden="true"
      style={{
        background: `var(--av${tone}-bg)`,
        color: `var(--av${tone}-fg)`,
      }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${size === "lg" ? "h-11 w-11 text-base" : "h-10 w-10 text-sm"}`}
    >
      {avatarInitial(name)}
    </span>
  );
}

Avatar.propTypes = {
  name: PropTypes.string.isRequired,
  size: PropTypes.oneOf(["md", "lg"]),
};
