/* ==========================================================================
   Layout shells — Foundations §02 "Layout shell" and Page Skeletons (sheet 04).

   Shells take slots, not variants: a page composes the header it needs and
   drops it in, rather than the shell branching on a page type it cannot know
   about. See the comment block in ./page-shell.tsx.
   ========================================================================== */

export { AppHeader } from "./app-header";

export { CheckoutProgress } from "./checkout-progress";
export type { CheckoutProgressProps, CheckoutStep } from "./checkout-progress";

export { StickyBar } from "./sticky-bar";

export { DetailLayout, PageHeader, PageShell, RailLayout, Section, Shell } from "./page-shell";

export { Breadcrumbs, SiteHeader, StepIndicator } from "./site-header";
export type { NavItem, SiteHeaderProps } from "./site-header";

export { SiteFooter } from "./site-footer";
export type { FooterColumn, SiteFooterProps } from "./site-footer";

export { LanguageSwitcher } from "./language-switcher";
