/**
 * The Focus Bar mascot — a toy poodle that dances in the shell background.
 *
 * Hand-authored SVG so nothing has to ship as a raster asset: the fluffy
 * silhouette is a cluster of circles drawn twice, once with a thick stroke for
 * the outline and once fill-only on top, which hides the interior strokes.
 * All motion lives in `device.css` and stops under reduced motion.
 */
export function Mascot(): React.ReactElement {
  return (
    // The viewBox is padded: the dance rotates and lifts the whole dog, and
    // the margin keeps the ears and the head tuft from clipping at the
    // extremes of the swing.
    <svg
      className="mascot"
      viewBox="-18 -22 236 278"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <g id="mascot-ear">
          <circle cx="44" cy="94" r="25" />
          <circle cx="34" cy="122" r="27" />
          <circle cx="38" cy="148" r="22" />
        </g>
        <g id="mascot-body">
          <circle cx="100" cy="206" r="56" />
          <circle cx="58" cy="212" r="34" />
          <circle cx="142" cy="212" r="34" />
          <circle cx="100" cy="180" r="44" />
        </g>
        <g id="mascot-head">
          <circle cx="100" cy="90" r="54" />
          <circle cx="62" cy="66" r="30" />
          <circle cx="138" cy="66" r="30" />
          <circle cx="100" cy="50" r="34" />
          <circle cx="68" cy="110" r="30" />
          <circle cx="132" cy="110" r="30" />
          <circle cx="100" cy="26" r="16" />
          <circle cx="84" cy="32" r="13" />
          <circle cx="116" cy="32" r="13" />
        </g>
      </defs>

      <g className="mascot__dancer">
        {/* chest */}
        <use href="#mascot-body" fill="#efd0a2" stroke="#6b4326" strokeWidth="5" />
        <use href="#mascot-body" fill="#efd0a2" />

        {/* ears — mirrored, swinging out of phase with the body sway */}
        <g className="mascot__ear mascot__ear--left">
          <use href="#mascot-ear" fill="#e9c491" stroke="#6b4326" strokeWidth="5" />
          <use href="#mascot-ear" fill="#e9c491" />
        </g>
        {/* The mirror lives on a wrapper: a CSS animation on this group would
            replace the `transform` attribute and flatten the flip. */}
        <g transform="translate(200 0) scale(-1 1)">
          <g className="mascot__ear mascot__ear--right">
            <use href="#mascot-ear" fill="#e9c491" stroke="#6b4326" strokeWidth="5" />
            <use href="#mascot-ear" fill="#e9c491" />
          </g>
        </g>

        <g className="mascot__head">
          <use href="#mascot-head" fill="#f3d6a8" stroke="#6b4326" strokeWidth="5" />
          <use href="#mascot-head" fill="#f3d6a8" />

          {/* muzzle */}
          <ellipse cx="100" cy="122" rx="39" ry="31" fill="#fbead0" />
          <ellipse cx="100" cy="106" rx="15" ry="12" fill="#2b2320" />
          <ellipse cx="94" cy="102" rx="4" ry="3" fill="#ffffff" opacity="0.75" />
          <path d="M100 118v9" stroke="#6b4326" strokeWidth="3" strokeLinecap="round" />

          {/* open smile with a tongue */}
          <path d="M76 127c6 24 42 24 48 0-6 21-42 21-48 0z" fill="#2b2320" />
          <path
            d="M78 130c7 20 37 20 44 0-5 22-39 22-44 0z"
            fill="#2b2320"
            stroke="#6b4326"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <ellipse cx="100" cy="142" rx="14" ry="9" fill="#f2a3a3" />

          {/* one eye open, one winking */}
          <ellipse cx="74" cy="88" rx="11" ry="13" fill="#2b2320" />
          <circle cx="70" cy="83" r="4" fill="#ffffff" />
          <path
            d="M116 90c8-9 18-9 26 0"
            fill="none"
            stroke="#2b2320"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>

        {/* collar + bone tag */}
        <g className="mascot__tag">
          <path
            d="M60 166c26 12 54 12 80 0v15c-26 12-54 12-80 0v-15z"
            fill="#d9342b"
            stroke="#6b4326"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path d="M100 182v9" stroke="#d9a441" strokeWidth="5" strokeLinecap="round" />
          <g fill="#f1eee2" stroke="#6b4326" strokeWidth="4">
            <rect x="86" y="192" width="28" height="14" rx="6" />
            <circle cx="88" cy="194" r="7" />
            <circle cx="88" cy="204" r="7" />
            <circle cx="112" cy="194" r="7" />
            <circle cx="112" cy="204" r="7" />
          </g>
          <rect x="88" y="194" width="24" height="10" fill="#f1eee2" />
        </g>
      </g>
    </svg>
  )
}
