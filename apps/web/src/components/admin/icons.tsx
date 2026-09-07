import type { SVGProps } from "react";

/* --------------------------------------------------------------------------
   Admin icons

   Drawn here rather than pulled from a library: the panel needs five, and a
   dependency for five is a dependency to keep current forever. They are one
   set — 24px box, 1.5 stroke, round caps and joins, `currentColor` — so they
   sit at the same weight as the 13.5px text beside them.

   All are decorative by default (`aria-hidden`): every one of them is inside a
   control that carries its own accessible name. The panel states things in
   words (principle 03); an icon here is never the only thing said.
   -------------------------------------------------------------------------- */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
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

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

/** Light. A disc with eight rays — the rays are what read at 16px, not the disc. */
export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.22 4.22l1.77 1.77M18.01 18.01l1.77 1.77M2 12h2.5M19.5 12H22M4.22 19.78l1.77-1.77M18.01 5.99l1.77-1.77" />
    </Icon>
  );
}

/** Dark. A waxing crescent cut from a disc, rather than a thin arc that vanishes. */
export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.2A8.2 8.2 0 019.8 4a8.4 8.4 0 100 20 8.2 8.2 0 0010.2-9.8z" />
    </Icon>
  );
}

/** System. A display on a stand — the OS deciding, not this app. */
export function MonitorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.75" y="4" width="18.5" height="12.5" rx="1.75" />
      <path d="M9 20.25h6M12 16.5v3.75" />
    </Icon>
  );
}
