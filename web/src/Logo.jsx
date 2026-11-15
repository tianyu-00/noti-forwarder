import PropTypes from "prop-types";

// The Notiforwarder mark: an arch with a dot (a lowercase n and a bell at once). The same drawing as
// public/favicon.svg and the install icons. Fixed brand colours, a solid fill so two on one page never
// share a gradient id.
export default function Logo({ className }) {
  return (
    <svg viewBox="0 0 108 108" aria-hidden="true" className={className}>
      <rect width="108" height="108" fill="#10201a" />
      <path
        d="M34 78 V54 a20 20 0 0 1 40 0 V78"
        fill="none"
        stroke="#f4f7f5"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <circle cx="54" cy="70" r="7" fill="#3ddc97" />
    </svg>
  );
}

Logo.propTypes = { className: PropTypes.string };
