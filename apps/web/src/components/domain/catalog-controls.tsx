"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Chip, OptionList } from "@/components/ui";
import { Modal } from "@/components/ui";
import { genres, type GenreValue } from "@/lib/books";
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
   -------------------------------------------------------------------------- */

const SEARCH_DEBOUNCE_MS = 300;

export function CatalogControls({ query }: { query: CatalogQuery }) {
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
    const genre = value as GenreValue;
    apply({
      genres: query.genres.includes(genre)
        ? query.genres.filter((item) => item !== genre)
        : [...query.genres, genre],
    });
  }

  const genreFacets = genres.map((genre) => ({
    value: genre.value,
    label: t(`catalog.genres.${genre.value}`),
  }));
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

      {/* Desktop — the genre bar sits open; mobile collapses it to a sheet. */}
      <div className="mt-4.5 hidden sm:block">
        <p className="eyebrow">{t("catalog.filters.genre")}</p>
        <FilterChips
          className="mt-3.5"
          facets={genreFacets}
          values={query.genres}
          onChange={toggleGenre}
          label={t("catalog.filters.genreLabel")}
        />
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
                  {t(`catalog.genres.${genre}`)} ✕
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
        <FilterChips
          facets={genreFacets}
          values={query.genres}
          onChange={toggleGenre}
          label={t("catalog.filters.genreLabel")}
        />
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
