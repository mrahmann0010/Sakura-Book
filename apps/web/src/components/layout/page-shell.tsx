import type { ElementType, ReactNode } from "react";

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
    <div className={cn("flex min-h-dvh flex-col bg-page", className)}>
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
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={cn("shell", className)}>{children}</Tag>;
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
      <aside className={cn("min-w-0", stickyRail && "lg:sticky lg:top-6")}>
        {rail}
      </aside>
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
  action,
  tint = false,
  children,
  className,
  titleAs: TitleTag = "h2",
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** "All 41 →" — the way through to the full list. */
  action?: ReactNode;
  tint?: boolean;
  children: ReactNode;
  className?: string;
  titleAs?: ElementType;
}) {
  const hasHead = Boolean(eyebrow || title || action);

  return (
    <section
      className={cn(tint && "rounded-container bg-tint p-8 sm:p-10", className)}
    >
      {hasHead ? (
        <div className="flex flex-wrap items-baseline justify-between gap-5">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? (
              <TitleTag
                className={cn(
                  "font-serif text-28 leading-tight text-ink lg:text-32",
                  eyebrow && "mt-3",
                )}
              >
                {title}
              </TitleTag>
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
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-gutter gap-y-8",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1
          className={cn(
            "font-serif leading-[1.06] text-ink",
            sizes[size],
            eyebrow && "mt-4",
          )}
        >
          {title}
        </h1>
        {description ? (
          // Colour comes from the body default; `text-body` here is the size.
          <p className="mt-5 max-w-measure-lede text-body">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
