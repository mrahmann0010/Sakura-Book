import type { SVGProps } from "react";

/* --------------------------------------------------------------------------
   Storefront icons

   The same house style as the admin set (components/admin/icons.tsx) and for
   the same reason: the shop needs a couple of glyphs, and `lucide-react` — in
   the tree already, but so far only on two admin pages — is half a megabyte of
   dependency to keep current in the public bundle for two paths.

   One set: 24px viewBox, 1.5 stroke, round caps and joins, `currentColor`, so
   they take the colour of whatever they sit in — `muted` at rest and white
   inside a clay button, per DESIGN_SYSTEM §8, which also says the accent is
   never spent on an icon except there.

   Rendered at 18 rather than the §8 20px box. That figure is written for a
   standalone IconButton, where the glyph is the whole control; beside a
   13.5px button label a 20px box out-sizes the words it is qualifying.

   `aria-hidden` by default, and deliberately so: every one of these sits in a
   button that already says what it does in words (principle 03). None of them
   is ever the only thing said.
   -------------------------------------------------------------------------- */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* A brand mark is not a line drawing: Facebook and Messenger are only legible
   as their own filled silhouettes, so these two drop the stroke and take
   `currentColor` as a fill instead. Same 24px box, same colour contract. */
function BrandIcon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Buy. A shop bag with its handle, which is already this project's purchase
 * metaphor — the "how it works" strip draws a book lowering into the same bag
 * (domain/how-it-works.tsx) — rather than a generic cart the shop does not
 * ask anyone to visit any more.
 */
export function BagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.25 7.75h15.5l-1.1 11.3a1.6 1.6 0 01-1.6 1.45H6.95a1.6 1.6 0 01-1.6-1.45z" />
      <path d="M8.75 10.5V7a3.25 3.25 0 016.5 0v3.5" />
    </Icon>
  );
}

/**
 * Read a sample. An open book, spine down the middle — the one shape that
 * cannot be mistaken for the closed cover sitting beside it on this page.
 */
export function BookOpenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 7.1C10.2 5.7 7.6 5.15 4.4 5.4a.85.85 0 00-.8.85v10.4c0 .5.4.88.9.85 2.9-.2 5.3.3 7.5 1.75" />
      <path d="M12 7.1c1.8-1.4 4.4-1.95 7.6-1.7.45.04.8.4.8.85v10.4c0 .5-.4.88-.9.85-2.9-.2-5.3.3-7.5 1.75" />
      <path d="M12 7.1v12.15" />
    </Icon>
  );
}

/**
 * Points at the sample. A hand-drawn-looking curve aimed into the cover beside
 * it, for the "read a sample" flag down the cover's edge — the one place in
 * the shop where a glyph has to say "this picture is a button", because a book
 * cover does not otherwise look pressable.
 */
export function SampleArrowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.2 19.6C5.2 12.6 8.6 7.4 16 5.6" />
      <path d="M16 5.6 12.1 4.7" />
      <path d="M16 5.6 14.3 9.3" />
    </Icon>
  );
}

/** Where we are. A pin, for the one contact row that is a place and not a link. */
export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 10.25c0 4.6-5.35 9.3-6.6 10.35a.6.6 0 01-.8 0C10.35 19.55 5 14.85 5 10.25a7 7 0 1114 0z" />
      <circle cx="12" cy="10.1" r="2.4" />
    </Icon>
  );
}

/** Email. A closed envelope with its flap creased down the middle. */
export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.25" y="5.25" width="17.5" height="13.5" rx="1.75" />
      <path d="M4.1 7.1l6.95 4.95a1.6 1.6 0 001.9 0L19.9 7.1" />
    </Icon>
  );
}

/** Messenger, where the conversation actually happens. */
export function MessengerIcon(props: IconProps) {
  return (
    <BrandIcon {...props}>
      <path d="M12 2C6.3 2 2 6.17 2 11.8c0 2.94 1.2 5.49 3.17 7.3.17.15.26.37.27.59l.05 1.8c.02.58.61.95 1.13.71l2.01-.88c.17-.08.36-.09.54-.04.92.25 1.9.39 2.91.39 5.7 0 10-4.17 10-9.8C22 6.17 17.7 2 12 2zm6.06 7.53l-2.96 4.71c-.47.75-1.5.94-2.2.4l-2.36-1.77a.6.6 0 00-.73 0l-3.18 2.42c-.42.32-.97-.19-.69-.64l2.96-4.71c.47-.75 1.5-.94 2.2-.4l2.36 1.77a.6.6 0 00.73 0l3.18-2.42c.42-.32.97.19.69.64z" />
    </BrandIcon>
  );
}

/** Facebook, as the page itself rather than the inbox. */
export function FacebookIcon(props: IconProps) {
  return (
    <BrandIcon {...props}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.19 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.25.2 2.25.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.75 8.42-4.92 8.42-9.94z" />
    </BrandIcon>
  );
}
