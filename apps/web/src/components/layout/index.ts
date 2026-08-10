/* ==========================================================================
   Layout shells — Foundations §02 "Layout shell" and Page Skeletons (sheet 04).

   Shells take slots, not variants: a page composes the header it needs and
   drops it in, rather than the shell branching on a page type it cannot know
   about. See the comment block in ./page-shell.tsx.
   ========================================================================== */

export { AppNav } from "./app-nav";

export { FloatingNav, useNavPill } from "./floating-nav";
export type {
  FloatingNavAction,
  FloatingNavItem,
  FloatingNavLink,
  FloatingNavProps,
  PillRect,
} from "./floating-nav";

export { CheckoutProgress } from "./checkout-progress";
export type { CheckoutProgressProps, CheckoutStep } from "./checkout-progress";

export { StickyBar } from "./sticky-bar";

export { DetailLayout, PageHeader, PageShell, RailLayout, Section, Shell } from "./page-shell";

export { Breadcrumbs } from "./breadcrumbs";

export { SiteFooter } from "./site-footer";
export type { FooterColumn, SiteFooterProps } from "./site-footer";

export { LanguageSwitcher } from "./language-switcher";
