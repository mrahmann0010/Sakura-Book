"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CategoryGroup } from "@sakura/contracts";

import { Button, Chip, OptionList } from "@/components/ui";
import { Modal } from "@/components/ui";
import { sortOptions, toSearchParams, type CatalogQuery } from "@/lib/catalog";
import { input } from "@/lib/variants";
import { cn } from "@/lib/utils";

import { FilterChips } from "./catalog-toolbar";

/* --------------------------------------------------------------------------
   Catalog controls — search, genre facets, sort.

   The query lives in the URL, so this component owns no filter state; it only
   writes to the address bar and lets the server component re-render. The one
   exception is the search box, which keeps a local value so typing stays
   responsive and pushes on a 300ms debounce.

   The facets are a prop, fetched server-side from GET /categories, rather than
   the hardcoded `genres` array this used to import. The `categories` table
   owns the shop's vocabulary; a rail built from a constant in the client
   bundle silently stops matching the database the first time staff add a
   category, and the symptom is a filter that returns nothing.
   -------------------------------------------------------------------------- */

const SEARCH_DEBOUNCE_MS = 300;

export type CatalogControlsProps = {
  query: CatalogQuery;
  /** Pre-grouped by the API, in `sort_order`. Rendered as one row per group. */
  facets: CategoryGroup[];
};

export function CatalogControls({ query, facets }: CatalogControlsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchId = useId();

  const [q, setQ] = useState(query.q);
  const [urlQ, setUrlQ] = useState(query.q);
  const [genreSheet, setGenreSheet] = useState(false);
  const [sortSheet, setSortSheet] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* Adjust the box during render when the URL moves underneath us — a back
     button, or a cleared filter. React's sanctioned alternative to syncing
     props into state from an effect. */
  if (query.q !== urlQ) {
    setUrlQ(query.q);
    setQ(query.q);
  }

  /* The timer is the one external system here, so it gets the one effect. */
  useEffect(() => () => clearTimeout(debounce.current), []);

  /** Any control change resets to page 1 — page 3 of the old filter is
      meaningless under the new one. */
  function apply(next: Partial<CatalogQuery>) {
    clearTimeout(debounce.current);
    router.push(`${pathname}${toSearchParams({ ...query, page: 1, ...next })}`, { scroll: false });
  }

  /** Typing stays local and instant; the URL catches up 300ms later. */
  function search(value: string) {
    setQ(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({ q: value }), SEARCH_DEBOUNCE_MS);
  }

  function toggleGenre(value: string) {
    apply({
      genres: query.genres.includes(value)
        ? query.genres.filter((item) => item !== value)
        : [...query.genres, value],
    });
  }

  /* Translate where we have a string for the slug, and fall back to the name
     the API sent otherwise. A category added by staff this morning has no
     translation key, and showing its English name beats showing the raw slug
     or, worse, the missing-key string. */
  const label = (slug: string, fallback: string) =>
    t(`catalog.genres.${slug}`, { defaultValue: fallback });

  const groups = facets.map((entry) => ({
    group: entry.group,
    heading: entry.group
      ? t(`catalog.groups.${entry.group}`, { defaultValue: entry.group })
      : t("catalog.filters.genre"),
    facets: entry.categories.map((category) => ({
      value: category.slug,
      label: label(category.slug, category.name),
    })),
  }));

  /* Applied chips render by slug, and the slug alone is not a label. */
  const labelBySlug = new Map(
    facets.flatMap((entry) =>
      entry.categories.map((category) => [category.slug, label(category.slug, category.name)]),
    ),
  );

  const sortChoices = sortOptions.map((option) => ({
    value: option.value,
    label: t(`catalog.sort.${option.value}`),
  }));
  const activeSort = sortChoices.find((option) => option.value === query.sort);
  const hasFilters = query.genres.length > 0 || query.q !== "";

  return (
    <div className="mt-8">
      {/* Search — full width, 44px, icon leading. */}
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {t("catalog.search.label")}
        </label>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-muted pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13 13 4 4" strokeLinecap="square" />
        </svg>
        <input
          id={searchId}
          type="search"
          value={q}
          onChange={(event) => search(event.target.value)}
          placeholder={t("catalog.search.placeholder")}
          className={cn(input({}), "pl-12")}
        />
      </div>

      {/* Desktop — the facet rows sit open; mobile collapses them to a sheet. */}
      <div className="mt-4.5 hidden space-y-4 sm:block">
        {groups.map((group) => (
          <div key={group.group ?? "ungrouped"}>
            <p className="eyebrow">{group.heading}</p>
            <FilterChips
              className="mt-3.5"
              facets={group.facets}
              values={query.genres}
              onChange={toggleGenre}
              label={group.heading}
            />
          </div>
        ))}
      </div>

      {/* Mobile — two 44px triggers. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:hidden">
        <Button variant="secondary" onClick={() => setGenreSheet(true)}>
          {query.genres.length > 0
            ? t("catalog.filters.genreCount", { count: query.genres.length })
            : t("catalog.filters.genre")}
        </Button>
        <Button variant="secondary" onClick={() => setSortSheet(true)}>
          {t("catalog.filters.sort")}
        </Button>
      </div>

      {/* Applied chips left, sort right. Chips scroll rather than wrap on mobile. */}
      <div className="mt-4.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="-mx-page-mobile px-page-mobile flex min-w-0 items-center gap-2.5 overflow-x-auto sm:mx-0 sm:flex-wrap sm:px-0">
          {hasFilters ? (
            <>
              <span className="eyebrow shrink-0">{t("catalog.filters.applied")}</span>
              {query.q ? (
                <Chip active onClick={() => apply({ q: "" })} className="shrink-0">
                  {t("catalog.filters.removeSearch", { q: query.q })}
                </Chip>
              ) : null}
              {query.genres.map((genre) => (
                <Chip key={genre} active onClick={() => toggleGenre(genre)} className="shrink-0">
                  {labelBySlug.get(genre) ?? genre} ✕
                </Chip>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => apply({ q: "", genres: [] })}
              >
                {t("catalog.filters.clear")}
              </Button>
            </>
          ) : null}
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <span className="eyebrow">{t("catalog.filters.sort")}</span>
          <select
            aria-label={t("catalog.filters.sort")}
            value={query.sort}
            onChange={(event) => apply({ sort: event.target.value as CatalogQuery["sort"] })}
            className={cn(input({ select: true }), "w-auto min-w-40")}
          >
            {sortChoices.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Modal
        open={genreSheet}
        onClose={() => setGenreSheet(false)}
        title={t("catalog.filters.genre")}
        actions={
          <>
            <Button onClick={() => setGenreSheet(false)}>{t("catalog.filters.done")}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                apply({ genres: [] });
                setGenreSheet(false);
              }}
            >
              {t("catalog.filters.clear")}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.group ?? "ungrouped"}>
              <p className="eyebrow">{group.heading}</p>
              <FilterChips
                className="mt-3.5"
                facets={group.facets}
                values={query.genres}
                onChange={toggleGenre}
                label={group.heading}
              />
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={sortSheet}
        onClose={() => setSortSheet(false)}
        title={t("catalog.filters.sort")}
        description={activeSort?.label}
      >
        <OptionList
          options={sortChoices}
          value={query.sort}
          label={t("catalog.filters.sort")}
          onSelect={(value) => {
            apply({ sort: value as CatalogQuery["sort"] });
            setSortSheet(false);
          }}
        />
      </Modal>
    </div>
  );
}
