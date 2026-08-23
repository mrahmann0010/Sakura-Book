import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * cva's `VariantProps` admits `null` for every variant, which leaks into DOM
 * attributes and index lookups. Component prop types use this instead: same
 * keys, optional, never null.
 */
export type Variants<T> = { [K in keyof T]?: NonNullable<T[K]> };

/**
 * This theme's numeric type scale — `text-13`, `text-36`, `text-13.5` — as
 * tailwind-merge cannot infer it.
 *
 * tailwind-merge decides what a `text-*` utility means from its *value*: the
 * font-size group matches `text-sm`, `text-2xl`, arbitrary values and the
 * like, and anything else falls through to the text-colour group, which
 * accepts any word. A bare number matches nothing it knows, so `text-13` was
 * being filed as a colour — and a colour conflicts with a colour, so in
 * `"bg-clay text-surface … px-5 py-2.5 text-13"` the later `text-13` won and
 * `text-surface` was dropped from the output entirely.
 *
 * That is not a cosmetic near-miss. Every primary button in the app lost its
 * white label and inherited `--body` from the page instead: ink-brown on clay
 * at 2.91:1, under the 4.5:1 floor for 13px text, on the one control each
 * screen most wants pressed. Secondary, ghost and destructive lost their
 * colours the same way, less visibly. The `[display:inline-block]` and
 * "plain class string, not cn()" workarounds on the landing page's headline
 * are the same bug worked around locally rather than fixed here.
 *
 * Only the numeric tokens are listed. The named ones — `text-body`,
 * `text-caption`, `text-eyebrow` — are genuinely ambiguous in this theme,
 * which defines both `--text-body` (a size) and `--color-body` (a colour)
 * under one name; teaching the merger to guess between them would be picking
 * a winner for call sites that mean different things by it. They keep the
 * existing behaviour.
 */
const TYPE_SCALE = [
  "10",
  "10.5",
  "11",
  "11.5",
  "12",
  "13",
  "13.5",
  "14.5",
  "15",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "24",
  "26",
  "28",
  "30",
  "32",
  "34",
  "36",
  "40",
  "42",
  "44",
  "48",
  "52",
  "56",
  "64",
  "68",
  "72",
  "120",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: TYPE_SCALE }],
    },
  },
});

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * On a touch device, the on-screen keyboard can cover the field a person just
 * tapped — nothing in a plain scrolling layout reserves space for it, so what
 * they're typing ends up hidden below the fold. Nudging the focused field back
 * into view after a short delay — long enough for the keyboard's own resize
 * animation to finish, so the browser measures the field's position against
 * the viewport the keyboard has already shrunk — keeps it visible.
 *
 * Gated on `(pointer: coarse)` rather than running unconditionally: a mouse
 * user has no keyboard to cover anything, and an unrequested scroll on every
 * field focus would just be a nuisance there.
 */
export function scrollFieldIntoView(event: { currentTarget: HTMLElement }) {
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;

  const target = event.currentTarget;
  window.setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
}
