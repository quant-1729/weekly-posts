import type { Dir, Face, PointDir, TweenState } from "@/lib/tween/machine";
import "./rig.css";

/**
 * Tween's rig: the approved mascot (rounded navy body, big eyes, cobalt scarf, peacock-feather morpankh) built from
 * separate parts so each can move. Tapered arms with an elbow and a paddle hand, tapered legs with flat feet, a scarf
 * tail that trails, and the feather. Poses are CSS variables per `data-state` (rig.css); this component only renders the
 * parts and reflects the state. Decorative: the buttons that wrap it carry the accessible names.
 */
export type RigProps = {
  state: TweenState;
  face: Face;
  facing: Dir;
  pointDir: PointDir;
  talking: boolean;
  /** Reduced motion, or the visitor paused animation: the rig keeps its pose but nothing loops. */
  still: boolean;
  /** Keeps the walk cycle running for a moment after walking stops so the legs settle instead of snapping. */
  cooling?: boolean;
  /** Mirror the whole character (used for the right-edge peek so the feather stays in view). */
  mirror?: boolean;
  className?: string;
};

const NAVY = "#0B1C30";
/** Slightly lighter navy for details drawn on top of navy (finger lines, wrist cuff). */
const NAVY_LIGHT = "#35557A";
const COBALT = "#2B4CFF";
const COBALT_DARK = "#203CD9";
const COBALT_LIGHT = "#5B78FF";
const WHITE = "#FFFFFF";
const CORAL = "#FF6B4A";
/** The morpankh keeps real peacock colours; this is the only teal and gold in the brand. */
const TEAL = "#119C9A";
const TEAL_DARK = "#0B6F73";
const TEAL_LIGHT = "#3CC6A8";
const GOLD = "#F3B63A";
const ORANGE = "#F26A21";
const EYE_BLUE = "#1D5FA8";

/**
 * One arm: a tapered upper arm, an elbow, a tapered forearm and a flat paddle hand with a thumb.
 * The thumb faces the body (left arm: +x, right arm: -x). `.tw-index` is an extended index finger shown only while pointing.
 * The arm hangs along +y from the shoulder; CSS rotates `.tw-arm` and `.tw-fore` for each pose.
 */
function Arm({ side }: { side: "l" | "r" }) {
  const t = side === "l" ? 1 : -1;
  return (
    <g className={`tw-arm tw-arm-${side}`}>
      <path d="M-10 0 L10 0 L7 54 L-7 54 Z" fill={NAVY} />
      <circle cx="0" cy="0" r="10" fill={NAVY} />
      <g transform="translate(0 54)">
        <g className="tw-fore">
          <circle cx="0" cy="0" r="7.5" fill={NAVY} />
          <path d="M-7.5 0 L7.5 0 L5.5 42 L-5.5 42 Z" fill={NAVY} />
          <path d="M-6.2 38 H6.2" stroke={NAVY_LIGHT} strokeWidth="3.4" strokeLinecap="round" />
          <g transform="translate(0 42)">
            <rect className="tw-index" x="-4.4" y="22" width="8.8" height="26" rx="4.4" fill={NAVY} />
            <path d="M-6 0 C-12 8 -14 22 -9 31 C-5 37 5 37 9 31 C14 22 12 8 6 0 Z" fill={NAVY} />
            <ellipse cx={t * 11} cy="9" rx="5" ry="9.5" fill={NAVY} transform={`rotate(${t * -28} ${t * 11} 9)`} />
            <g className="tw-fingers" stroke={NAVY_LIGHT} strokeWidth="2.2" strokeLinecap="round" fill="none">
              <path d="M-3.4 22 V30" />
              <path d="M3.4 22 V30" />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

export function TweenRig({ state, face, facing, pointDir, talking, still, cooling, mirror, className = "" }: RigProps) {
  return (
    <svg
      viewBox="10 12 380 462"
      className={`tw-rig ${className}`.trim()}
      data-state={state}
      data-face={face}
      data-facing={facing}
      data-point={pointDir}
      data-talking={talking ? "true" : "false"}
      data-still={still ? "true" : "false"}
      data-cycle={state === "walk" || cooling ? "walk" : "none"}
      aria-hidden="true"
      focusable="false"
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    >
      <ellipse className="tw-shadow" cx="200" cy="452" rx="98" ry="12" fill={NAVY} opacity="0.1" />
      <g className="tw-all">
        <g className="tw-bob">
          {/* legs: hip joints sit inside the body; tapered, with flat feet turned slightly outward */}
          <g transform="translate(172 340)">
            <g className="tw-leg tw-leg-l">
              <path d="M-8.5 0 L8.5 0 L5 86 L-5 86 Z" fill={NAVY} />
              <ellipse cx="-14" cy="95" rx="29" ry="12.5" fill={NAVY} />
            </g>
          </g>
          <g transform="translate(228 340)">
            <g className="tw-leg tw-leg-r">
              <path d="M-8.5 0 L8.5 0 L5 86 L-5 86 Z" fill={NAVY} />
              <ellipse cx="14" cy="95" rx="29" ry="12.5" fill={NAVY} />
            </g>
          </g>

          {/* arms sit behind the body so the shoulder joins cleanly */}
          <g transform="translate(108 256)">
            <Arm side="l" />
          </g>
          <g transform="translate(292 256)">
            <Arm side="r" />
          </g>

          <rect x="96" y="88" width="208" height="262" rx="66" fill={NAVY} />

          <g className="tw-face">
            <g className="tw-eyes">
              <ellipse cx="156" cy="190" rx="33" ry="36" fill={WHITE} />
              <ellipse cx="244" cy="190" rx="33" ry="36" fill={WHITE} />
              <g className="tw-pupils">
                <circle cx="163" cy="193" r="17" fill={NAVY} />
                <circle cx="251" cy="193" r="17" fill={NAVY} />
                <circle cx="168" cy="187" r="5" fill={WHITE} />
                <circle cx="256" cy="187" r="5" fill={WHITE} />
              </g>
            </g>
            {/* closed eyes: asleep (rests) and delighted (arcs up) */}
            <g className="tw-eyes-sleep" fill="none" stroke={WHITE} strokeWidth="8" strokeLinecap="round">
              <path d="M126 188 Q156 216 186 188" />
              <path d="M214 188 Q244 216 274 188" />
            </g>
            <g className="tw-eyes-joy" fill="none" stroke={WHITE} strokeWidth="9" strokeLinecap="round">
              <path d="M130 200 Q156 160 182 200" />
              <path d="M218 200 Q244 160 270 200" />
            </g>
            {/* brows: thinking (one raised) and worried (both slanted) */}
            <path className="tw-brows-think" d="M134 140 L178 133" stroke={WHITE} strokeWidth="7" strokeLinecap="round" />
            <g className="tw-brows-worried" stroke={WHITE} strokeWidth="7" strokeLinecap="round">
              <path d="M132 148 L180 134" />
              <path d="M268 148 L220 134" />
            </g>
            {/* mouths: one shown per face; three open shapes cycle while talking */}
            <path className="tw-m tw-m-smile" d="M181 252 Q200 268 219 252" fill="none" stroke={WHITE} strokeWidth="7" strokeLinecap="round" />
            <path className="tw-m tw-m-happy" d="M172 248 Q200 282 228 248 Z" fill={WHITE} />
            <path className="tw-m tw-m-flat" d="M186 258 L214 254" fill="none" stroke={WHITE} strokeWidth="7" strokeLinecap="round" />
            <path className="tw-m tw-m-wavy" d="M182 264 Q191 254 200 264 Q209 274 218 264" fill="none" stroke={WHITE} strokeWidth="7" strokeLinecap="round" />
            <path className="tw-m tw-m-sleep" d="M190 258 Q200 265 210 258" fill="none" stroke={WHITE} strokeWidth="6" strokeLinecap="round" />
            <g className="tw-m tw-m-joy">
              <path d="M168 246 Q200 294 232 246 Z" fill={WHITE} />
              <path d="M184 270 Q200 282 216 270 Q200 264 184 270 Z" fill={COBALT} />
            </g>
            <ellipse className="tw-m tw-ma" cx="200" cy="258" rx="13" ry="10" fill={WHITE} />
            <path className="tw-m tw-mb" d="M176 249 Q200 278 224 249 Z" fill={WHITE} />
            <ellipse className="tw-m tw-mc" cx="200" cy="259" rx="7" ry="8" fill={WHITE} />
          </g>

          {/* cover pose: both hands over the eyes; the right hand sits lower so one eye peeks over the fingers */}
          <g className="tw-cover" stroke={NAVY_LIGHT} strokeLinecap="round">
            <rect x="116" y="150" width="80" height="68" rx="26" fill={NAVY} strokeWidth="3" />
            <path d="M136 152 V176 M156 151 V176 M176 152 V176" strokeWidth="3" fill="none" />
            <ellipse cx="114" cy="200" rx="9" ry="15" fill={NAVY} strokeWidth="3" transform="rotate(20 114 200)" />
            <rect x="204" y="172" width="80" height="62" rx="26" fill={NAVY} strokeWidth="3" />
            <path d="M224 174 V196 M244 173 V196 M264 174 V196" strokeWidth="3" fill="none" />
            <ellipse cx="286" cy="218" rx="9" ry="15" fill={NAVY} strokeWidth="3" transform="rotate(-20 286 218)" />
          </g>

          {/* the morpankh: a real peacock feather, the only teal and gold in the brand */}
          <g className="tw-feather">
            <g transform="translate(268 112) rotate(22) scale(0.84)">
              <path d="M0 6 C-40 -30 -42 -98 0 -152 C42 -98 40 -30 0 6 Z" fill={TEAL} />
              <path d="M0 -2 C-28 -32 -30 -92 0 -138 C30 -92 28 -32 0 -2 Z" fill={TEAL_LIGHT} opacity="0.55" />
              <path d="M0 6 L0 -58" stroke={TEAL_DARK} strokeWidth="3.5" strokeLinecap="round" />
              <path d="M-9 -20 L-26 -34 M9 -20 L26 -34 M-12 -42 L-30 -58 M12 -42 L30 -58 M-12 -118 L-24 -128 M12 -118 L24 -128" stroke={TEAL_DARK} strokeWidth="2.6" strokeLinecap="round" opacity="0.75" />
              <ellipse cx="0" cy="-92" rx="20" ry="26" fill={GOLD} />
              <ellipse cx="0" cy="-92" rx="14" ry="19" fill={ORANGE} />
              <ellipse cx="0" cy="-92" rx="8.6" ry="12.4" fill={EYE_BLUE} />
              <ellipse cx="0" cy="-92" rx="4.6" ry="7.6" fill={NAVY} />
              <circle cx="-1.6" cy="-95" r="1.6" fill={WHITE} />
            </g>
          </g>

          {/* scarf: the tail hangs from the knot on the wearer's right and trails opposite to the direction of travel */}
          <g transform="translate(126 314)">
            <g className="tw-tail">
              <path d="M-22 -8 L-30 82 Q-30 94 -18 95 L8 97 Q22 97 22 86 L20 -8 Z" fill={COBALT_DARK} />
              <path d="M-3 -4 L-6 90" stroke={COBALT_LIGHT} strokeWidth="3" strokeLinecap="round" opacity="0.55" />
            </g>
          </g>
          <rect x="88" y="284" width="224" height="46" rx="23" fill={COBALT} />
          <path d="M106 297 Q200 308 294 297" fill="none" stroke={COBALT_LIGHT} strokeWidth="4" strokeLinecap="round" opacity="0.6" />
          <path d="M106 318 Q200 330 294 318" fill="none" stroke={COBALT_DARK} strokeWidth="4" strokeLinecap="round" opacity="0.5" />
        </g>

        {/* state props: thought dots, sleeping z glyphs, celebration confetti */}
        <g className="tw-dots" fill={COBALT}>
          <circle className="tw-dot1" cx="88" cy="78" r="6" />
          <circle className="tw-dot2" cx="66" cy="52" r="9" />
          <circle className="tw-dot3" cx="42" cy="22" r="13" />
        </g>
        <g className="tw-zs" fill="none" stroke={COBALT} strokeLinecap="round" strokeLinejoin="round">
          <path className="tw-z1" d="M70 70 H90 L70 94 H90" strokeWidth="6" />
          <path className="tw-z2" d="M48 44 H64 L48 64 H64" strokeWidth="5" />
          <path className="tw-z3" d="M32 22 H44 L32 38 H44" strokeWidth="4" />
        </g>
        <g className="tw-confetti">
          <circle cx="58" cy="96" r="7" fill={COBALT} />
          <rect x="332" y="86" width="14" height="14" rx="3" fill={CORAL} transform="rotate(20 339 93)" />
          <rect x="36" y="168" width="12" height="12" rx="3" fill={CORAL} transform="rotate(-18 42 174)" />
          <circle cx="352" cy="160" r="6" fill={COBALT} />
          <path d="M96 40 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 z" fill={COBALT_DARK} />
        </g>
      </g>
    </svg>
  );
}

/**
 * Squash and stretch on landing: sets `data-land` on a rig for one bounce. "soft" is the small settle after a walk;
 * "hard" is the drop from a height. CSS ignores it while the rig is still.
 */
export function squash(svg: SVGElement | null | undefined, kind: "soft" | "hard" = "hard") {
  if (!svg) return;
  svg.removeAttribute("data-land");
  // force a style flush so a second landing in a row restarts the animation
  void svg.getBoundingClientRect();
  svg.setAttribute("data-land", kind);
  window.setTimeout(() => {
    if (svg.getAttribute("data-land") === kind) svg.removeAttribute("data-land");
  }, kind === "hard" ? 520 : 380);
}
