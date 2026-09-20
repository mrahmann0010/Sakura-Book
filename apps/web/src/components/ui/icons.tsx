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
