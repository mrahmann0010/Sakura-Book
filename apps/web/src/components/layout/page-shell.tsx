import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   Page shells

   The references show three page shapes, and they differ only in what sits in
   the header and whether a rail is present:

     browse       header with nav · content · footer   (home, catalog, detail)
     transactional  header with step indicator · content · no footer
                                                       (cart, checkout, confirmation)
     utility      header with nav · narrow content     (track order, support)

   So PageShell takes `header` and `footer` as slots rather than exposing a
   `variant` that switches between hardcoded headers — a page composes the
   header it needs and the shell stays out of it.
   -------------------------------------------------------------------------- */

export function PageShell({
  header,
  footer,
  children,
  className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-page flex min-h-dvh flex-col", className)}>
      {header}
      <main className="flex-1">{children}</main>
      {footer}
    </div>
  );
}

/** The centred 1280px container with the responsive page margin. */
export function Shell({
  children,
  as: Tag = "div",
  className,
  /* Rest props pass through: a loading Shell needs `aria-busy`, a landmark
     needs `aria-label`, and neither is worth a prop of its own. */
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  children: ReactNode;
  as?: ElementType;
}) {
  return (
    <Tag className={cn("shell", className)} {...props}>
      {children}
    </Tag>
  );
}

/**
 * Content · summary rail, 7fr/5fr with a 56px gap — the cart, checkout and
 * confirmation layout. Stacks under desktop with the rail below the content,
 * which is the assumption §11.10 flags.
 */
export function RailLayout({
  children,
  rail,
  /** Checkout keeps its rail in view; the cart does not need to. */
  stickyRail = false,
  className,
}: {
  children: ReactNode;
  rail: ReactNode;
  stickyRail?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rail", className)}>
      <div className="min-w-0">{children}</div>
      <aside className={cn("min-w-0", stickyRail && "lg:sticky lg:top-6")}>{rail}</aside>
    </div>
  );
}

/**
 * Book detail: 320px cover · content · 300px buy rail, 64px gaps. The rail
 * sticks at 24px from the top, as drawn.
 */
export function DetailLayout({
  cover,
  rail,
  children,
  className,
}: {
  cover: ReactNode;
  rail: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid-detail", className)}>
      <div className="min-w-0">{cover}</div>
      <div className="min-w-0">{children}</div>
      <aside className="min-w-0 lg:sticky lg:top-6">{rail}</aside>
    </div>
  );
}

/**
 * A block of page. `tint` is the full-bleed alternating section — never a
 * second colour, and never nested in another tinted block.
 */
export function Section({
  eyebrow,
  title,
  description,
  action,
  tint = false,
  children,
  className,
  titleAs: TitleTag = "h2",
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** One line under the title, as the landing shelves are drawn. */
  description?: ReactNode;
  /** "All 41 →" — the way through to the full list. */
  action?: ReactNode;
  tint?: boolean;
  children: ReactNode;
  className?: string;
  titleAs?: ElementType;
}) {
  const hasHead = Boolean(eyebrow || title || description || action);

  return (
    <section className={cn(tint && "rounded-container bg-tint p-8 sm:p-10", className)}>
      {hasHead ? (
        <div className="flex flex-wrap items-baseline justify-between gap-5">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? (
              <TitleTag
                className={cn(
                  "text-28 text-ink lg:text-32 font-serif leading-tight",
                  eyebrow && "mt-3",
                )}
              >
                {title}
              </TitleTag>
            ) : null}
            {description ? (
              <p className="max-w-measure-lede text-caption text-secondary mt-3">{description}</p>
            ) : null}
          </div>
          {action ? <div className="text-13 text-secondary">{action}</div> : null}
        </div>
      ) : null}

      <div className={cn(hasHead && "mt-9")}>{children}</div>
    </section>
  );
}

/**
 * The opener of a page: kicker, display title, lede, and controls to the
 * right. Catalog, cart and track-order all use this shape at different sizes.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "md",
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** `lg` is a page opener (52px), `md` a section title (44px), `sm` 36px. */
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "text-30 lg:text-36",
    md: "text-36 lg:text-44",
    lg: "text-40 lg:text-52",
  } as const;

  return (
    <div className={cn("gap-x-gutter flex flex-wrap items-end justify-between gap-y-8", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className={cn("text-ink font-serif leading-[1.06]", sizes[size], eyebrow && "mt-4")}>
          {title}
        </h1>
        {description ? (
          // Colour comes from the body default; `text-body` here is the size.
          <p className="max-w-measure-lede text-body mt-5">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
