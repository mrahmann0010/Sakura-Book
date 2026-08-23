"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/* ==========================================================================
   Floating nav

   A fixed, full-width header holding a centred max-width bar that floats clear
   of the viewport edge. Behind the labels sits ONE pill element that slides
   between items on left/width — not a per-item background that cross-fades, so
   the movement reads as a single object tracking the pointer.

   The pill follows hover and keyboard focus; with neither, it rests on the
   active route. Its position is measured from the DOM rather than assumed,
   because the labels are webfont text of unknown width (see useNavPill).
   ========================================================================== */

/* --------------------------------------------------------------------------
   Types
   -------------------------------------------------------------------------- */

/**
 * Fields every item shares, whatever it renders as.
 *
 * `content` exists so an item can carry more than a word — the cart needs a
 * count beside its label — without the nav learning what a cart is. `label`
 * stays required either way: it keys the list and names the item for a screen
 * reader when `content` is a glyph.
 *
 * `className` lands on the <li>, which is what lets an item be present in the
 * array but shown only at some widths. Measurement copes: a display:none item
 * measures 0 wide and the pill simply stays hidden for it.
 */
type FloatingNavItemBase = {
  label: string;
  content?: ReactNode;
  className?: string;
};

/** An item that navigates. Renders a next/link <a>. */
export type FloatingNavLink = FloatingNavItemBase & {
  kind: "link";
  href: string;
};

/**
 * An item that performs an action — opening a modal or panel. Renders a
 * <button>. Never an anchor: it has no destination, so it is not a link.
 */
export type FloatingNavAction = FloatingNavItemBase & {
  kind: "action";
  onSelect: () => void;
};

export type FloatingNavItem = FloatingNavLink | FloatingNavAction;

export type FloatingNavProps = {
  items: FloatingNavItem[];
  /** Wordmark, left of the items. */
  brand?: ReactNode;
  brandHref?: string;
  /** Right-hand slot — language switcher, cart, theme toggle. */
  actions?: ReactNode;
  /**
   * Scroll distance, in px, past which the bar takes on its frosted surface.
   * Small on purpose: the transition should read as a response to scrolling at
   * all, not as a threshold the reader has to hunt for.
   */
  scrollThreshold?: number;
  className?: string;
};

/** Left edge and width of the pill, in px, relative to the item list. */
export type PillRect = { left: number; width: number };

/* --------------------------------------------------------------------------
   useNavPill — the measurement logic, isolated so it can be tested apart from
   the markup.

   Every item's box is measured from the DOM and cached; the pill then reads
   the cached box for whichever index is currently targeted. Re-measurement is
   driven by the four things that can invalidate a box:

     mount          nothing is known until the first layout
     route change   the active item changes weight (semibold is wider)
     resize         the list reflows at breakpoints and on padding changes
     fonts.ready    the swap from the fallback face to Public Sans changes
                    every label's width — without this the pill is visibly
                    misaligned until the first hover on a cold load

   `visible` stays false until a target exists AND has been measured, which is
   what stops the pill flying in from x=0 on the first hover of the session.
   -------------------------------------------------------------------------- */

export type UseNavPillResult = {
  /** Attach to the element the items are laid out in. */
  listRef: React.RefObject<HTMLUListElement | null>;
  /** Attach to each item's interactive element, by index. */
  setItemRef: (index: number) => (node: HTMLElement | null) => void;
  /** Where the pill should sit. Null before the first successful measurement. */
  rect: PillRect | null;
  /** False when no item is targeted — the pill fades out rather than parking. */
  visible: boolean;
};

export function useNavPill(
  itemCount: number,
  /** The item under pointer or keyboard focus, if any. */
  targetIndex: number | null,
  /** Falls back to this when nothing is targeted. -1 for "no active route". */
  activeIndex: number,
): UseNavPillResult {
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [rects, setRects] = useState<PillRect[]>([]);

  const setItemRef = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      itemRefs.current[index] = node;
    },
    [],
  );

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const listLeft = list.getBoundingClientRect().left;

    /* Offsets are taken relative to the list, not the page, so the pill's
       coordinates survive the header being fixed and the page scrolling. */
    const next = itemRefs.current.slice(0, itemCount).map((node) => {
      if (!node) return { left: 0, width: 0 };
      const box = node.getBoundingClientRect();
      return { left: box.left - listLeft, width: box.width };
    });

    setRects((previous) =>
      previous.length === next.length &&
      previous.every((r, i) => r.left === next[i].left && r.width === next[i].width)
        ? previous
        : next,
    );
  }, [itemCount]);

  /* Measure before paint so the pill is never rendered at a stale position. */
  useLayoutEffect(() => {
    measure();
  }, [measure, activeIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    /* Items too: a label can change width without the list's box moving. */
    for (const node of itemRefs.current) if (node) observer.observe(node);

    return () => observer.disconnect();
  }, [measure, itemCount]);

  useEffect(() => {
    /* `fonts` is absent in jsdom and older Safari — the hook still works, it
       just relies on the ResizeObserver catching the reflow. */
    if (typeof document === "undefined" || !document.fonts) return;

    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
    };
  }, [measure]);

  const resolved = targetIndex ?? activeIndex;
  const rect = resolved >= 0 ? (rects[resolved] ?? null) : null;

  return {
    listRef,
    setItemRef,
    rect,
    visible: rect !== null && rect.width > 0,
  };
}

/* --------------------------------------------------------------------------
   usePrefersReducedMotion

   Reduced motion keeps the opacity fade — it carries the meaning, and a fade
   is not vestibular motion — but drops the slide, so the pill cuts to its new
   item instead of travelling. The global rule in globals.css already zeroes
   transition-duration, but the pill's transform is set inline, so it needs the
   value at render time rather than in a stylesheet.
   -------------------------------------------------------------------------- */

function usePrefersReducedMotion(): boolean {
  /* useSyncExternalStore rather than an effect: the media query is external
     state that already exists at first render, so reading it in a snapshot
     avoids the extra render an effect-then-setState pass would cost. The
     server snapshot is `false` — the markup is identical either way, only the
     inline transitionDuration differs, and that settles on hydration. */
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/* --------------------------------------------------------------------------
   useScrolledPast
   -------------------------------------------------------------------------- */

function useScrolledPast(threshold: number): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("scroll", onChange, { passive: true });
    return () => window.removeEventListener("scroll", onChange);
  }, []);

  /* Reading scrollY in the snapshot rather than an effect means a reload
     part-way down the page renders the frosted bar immediately, instead of
     flashing the transparent one for a frame. */
  return useSyncExternalStore(
    subscribe,
    () => window.scrollY > threshold,
    () => false,
  );
}

/* --------------------------------------------------------------------------
   Component
   -------------------------------------------------------------------------- */

export function FloatingNav({
  items,
  brand = "Nihonova Books",
  brandHref = "/",
  actions,
  scrollThreshold = 8,
  className,
}: FloatingNavProps) {
  const pathname = usePathname();
  const scrolled = useScrolledPast(scrollThreshold);
  const reducedMotion = usePrefersReducedMotion();

  /* Hover and focus are one state: both mean "the reader is pointed at this
     item", and the pill should not be able to be in two places at once. */
  const [targetIndex, setTargetIndex] = useState<number | null>(null);

  const activeIndex = useMemo(() => {
    /* Longest matching href wins, so /notes/a-post keeps Notes lit rather
       than falling through to the "/" item that also prefix-matches. */
    let best = -1;
    let bestLength = -1;

    items.forEach((item, index) => {
      if (item.kind !== "link") return;
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && item.href.length > bestLength) {
        best = index;
        bestLength = item.href.length;
      }
    });

    return best;
  }, [items, pathname]);

  const { listRef, setItemRef, rect, visible } = useNavPill(items.length, targetIndex, activeIndex);

  return (
    <>
      {/* The bar is fixed, so it is out of flow and would sit on top of the
          first screenful. This reserves its height in the document rather than
          asking every page to remember a magic top padding. */}
      <div aria-hidden className="h-15 sm:h-17" />

      <header
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-40",
          /* The bar floats: full-width header, inset content. The page margin is
           narrower here than --spacing-page-mobile so the items keep their own
           padding at 375px rather than surrendering it to the gutter — and
           narrower again below the tablet floor, where every px it gives back
           is a px the item list does not have to scroll. */
          "lg:px-page-tablet px-3 pt-4 sm:px-5 sm:pt-5",
          className,
        )}
      >
        <div
          className={cn(
            /* Below sm, the wordmark and actions cluster are both hidden, so
             justify-between has only the nav item list to place — it pins
             flush to the start against an invisible 0-width actions div.
             Centering here instead keeps the pill bar visually balanced. */
            "max-w-shell pointer-events-auto mx-auto flex items-center justify-center gap-1 sm:justify-between",
            "rounded-pill border sm:gap-3 lg:gap-6",
            /* Padding shrinks with the viewport; the nav never collapses to a
             hamburger, so every item stays reachable at every width — which
             means the padding, not the item set, is what gives way. Three
             steps rather than two: 640px is the tightest width in the whole
             range, because it is where the wordmark, the full labels, the
             locale pill and the Cart link all appear and the viewport has not
             grown to carry them yet. */
            "py-1.5 pr-1 pl-1 sm:pr-2 sm:pl-3 lg:pr-3 lg:pl-5",
            "transition-[background-color,border-color,backdrop-filter]",
            "ease-standard duration-(--duration-slide)",
            scrolled
              ? /* saturate() lifts the colour the blur washes out, so a book
                 cover passing underneath stays a colour and not grey. */
                "bg-frost border-rule [backdrop-filter:blur(12px)_saturate(180%)]"
              : "border-transparent bg-transparent",
          )}
        >
          {/* The wordmark stands down below the tablet floor. It links to the
            same place the first nav item does, and at 375px the items are what
            the reader needs the width for. */}
          <Link
            href={brandHref}
            className="wordmark hover:text-clay hidden shrink-0 px-1 whitespace-nowrap sm:block"
          >
            {brand}
          </Link>

          <nav
            aria-label="Primary"
            /* Safety valve: a longer item set, a wider locale or a large font
             size scrolls rather than colliding. The pill's coordinates are
             list-relative, so it stays aligned inside the scroller. */
            /* `-my-1 py-1` buys the focus ring its 2px width plus 2px offset
             back: an overflow-x scroller clips on Y too, and without the
             headroom the ring is sliced flat top and bottom. */
            className="-my-1 min-w-0 scrollbar-none overflow-x-auto py-1 [&::-webkit-scrollbar]:hidden"
          >
            <ul
              ref={listRef}
              className="relative flex w-max items-center"
              onPointerLeave={() => setTargetIndex(null)}
              onBlur={(event) => {
                /* Only clear when focus leaves the list entirely — moving
                 between items must not flicker the pill off and on. */
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setTargetIndex(null);
                }
              }}
            >
              {/* One pill, moved. Rendered first so it paints behind the labels,
                and aria-hidden because it carries no information a screen
                reader cannot get from aria-current. */}
              <li
                aria-hidden
                className={cn(
                  "bg-tint rounded-pill absolute inset-y-0 left-0 z-0",
                  "transition-[opacity,transform,width]",
                  "ease-standard",
                  visible ? "opacity-100" : "opacity-0",
                )}
                style={{
                  width: rect?.width ?? 0,
                  transform: `translateX(${rect?.left ?? 0}px)`,
                  /* Opacity always animates; the slide is dropped under reduced
                   motion by giving transform/width no duration of their own. */
                  transitionDuration: reducedMotion
                    ? "var(--duration-press), 0ms, 0ms"
                    : "var(--duration-press), var(--duration-slide), var(--duration-slide)",
                }}
              />

              {items.map((item, index) => {
                const isActive = index === activeIndex;
                const ref = setItemRef(index);

                const shared = {
                  onPointerEnter: () => setTargetIndex(index),
                  onFocus: () => setTargetIndex(index),
                  className: cn(
                    /* Tight horizontal padding until the desktop floor. The
                       squeeze is worst at exactly 640px, where the wordmark,
                       the long "Track Order" label, the locale pill and the
                       Cart link all arrive at once and the bar is still only
                       640 wide — the gap between labels is what pays for them.
                       It opens back up to 14px at `lg`, where there is room. */
                    "text-13.5 rounded-pill flex items-center gap-1.5 px-1.5 py-2 whitespace-nowrap lg:px-3.5",
                    "transition-colors duration-(--duration-press)",
                    /* The base :focus-visible rule squares the outline to
                     --radius-xs; the pill's radius is restated so the ring
                     hugs the shape the reader can actually see. */
                    "focus-visible:rounded-pill",
                    isActive ? "text-ink font-semibold" : "text-secondary hover:text-ink",
                  ),
                };

                return (
                  <li key={item.label} className={cn("relative z-10", item.className)}>
                    {item.kind === "link" ? (
                      <Link
                        {...shared}
                        ref={ref as React.Ref<HTMLAnchorElement>}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={item.content ? item.label : undefined}
                      >
                        {item.content ?? item.label}
                      </Link>
                    ) : (
                      <button
                        {...shared}
                        ref={ref as React.Ref<HTMLButtonElement>}
                        type="button"
                        onClick={item.onSelect}
                        aria-label={item.content ? item.label : undefined}
                      >
                        {item.content ?? item.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">{actions}</div>
        </div>
      </header>
    </>
  );
}
