import type { BookSummary } from "@/components/domain";

/* Placeholder catalogue.

   Mostly retired. The landing page, the catalog and the book detail page now
   read GET /books through lib/api/catalog.ts, and `queryCatalog` — which
   filtered and sorted this array — is gone.

   What still leans on it, and why it is worth writing down rather than
   leaving to be discovered:

     · `getBookById` resolves a persisted cart line back to a book, and it is
       keyed on these placeholder ids. The cards now hand the cart the API's
       UUID, so a cart built today will not resolve against this map. Fixing
       that means re-pointing the cart at the API (or at the checkout quote,
       which already prices server-side), and it touches checkout — a separate
       pass on purpose.
     · `titlesInStock` is a constant the cart and checkout empty states quote.
       The landing page no longer uses it; it reads `total` off the list.
     · `recentlyAdded` / `staffPicks` are still what /playground renders, which
       is the one page that should stay independent of a running API.

   `primaryNav` and `footerColumns` below are not placeholders — they are the
   app's own link tables and have no server behind them. */

/** Genre is a catalog facet, not something a card renders — so it sits here
    rather than widening BookSummary. */
export type CatalogBook = BookSummary & { genre: GenreValue };

export const genres = [
  { value: "fiction", label: "Fiction" },
  { value: "essays", label: "Essays" },
  { value: "poetry", label: "Poetry" },
  { value: "translated", label: "Translated" },
  { value: "nature", label: "Nature" },
] as const;

export type GenreValue = (typeof genres)[number]["value"];

/** Six titles, freshly shelved. */
export const recentlyAdded: CatalogBook[] = [
  {
    id: "the-quiet-shelf",
    title: "The Quiet Shelf",
    author: "Ana Belén Ruiz",
    priceCents: 1400,
    href: "/books/the-quiet-shelf",
    flag: "editors-pick",
    genre: "essays",
    rating: 4.6,
    ratingCount: 128,
  },
  {
    id: "letters-to-a-cartographer",
    title: "Letters to a Cartographer",
    author: "Hiroshi Tanabe",
    priceCents: 1150,
    href: "/books/letters-to-a-cartographer",
    flag: "last-copy",
    genre: "translated",
    rating: 4.2,
    ratingCount: 64,
  },
  {
    id: "salt-and-almanac",
    title: "Salt and Almanac",
    author: "Marguerite Okonkwo",
    priceCents: 1600,
    href: "/books/salt-and-almanac",
    flag: "signed",
    genre: "poetry",
    rating: 4.8,
    ratingCount: 41,
  },
  {
    id: "a-winter-of-small-repairs",
    title: "A Winter of Small Repairs",
    author: "Tomas Lindqvist",
    priceCents: 1200,
    href: "/books/a-winter-of-small-repairs",
    genre: "fiction",
    rating: 4.1,
    ratingCount: 96,
  },
  {
    id: "the-long-field",
    title: "The Long Field",
    author: "Ide Ó Cuinneagáin",
    priceCents: 1350,
    href: "/books/the-long-field",
    soldOut: true,
    genre: "nature",
    rating: 4.4,
    ratingCount: 73,
  },
  {
    id: "nine-bridges",
    title: "Nine Bridges",
    author: "Petra Sandoval",
    priceCents: 1500,
    href: "/books/nine-bridges",
    genre: "fiction",
    rating: 3.9,
    ratingCount: 52,
  },
];

/** The second shelf. Same card, no badge. */
export const staffPicks: CatalogBook[] = [
  {
    id: "an-orchard-in-reverse",
    title: "An Orchard in Reverse",
    author: "Cordelia Nwachukwu",
    priceCents: 1300,
    href: "/books/an-orchard-in-reverse",
    genre: "poetry",
    rating: 4.7,
    ratingCount: 88,
  },
  {
    id: "the-weather-in-other-rooms",
    title: "The Weather in Other Rooms",
    author: "Jonas Ferreira",
    priceCents: 1050,
    href: "/books/the-weather-in-other-rooms",
    format: "Paperback",
    genre: "translated",
    rating: 4.0,
    ratingCount: 37,
  },
  {
    id: "everything-we-kept",
    title: "Everything We Kept",
    author: "Su-jin Park",
    priceCents: 1700,
    href: "/books/everything-we-kept",
    format: "Paperback",
    genre: "fiction",
    rating: 4.5,
    ratingCount: 115,
  },
];

/** Everything on the shelves. The catalog page filters over this. */
export const catalog: CatalogBook[] = [...recentlyAdded, ...staffPicks];

/** Shown on the hero count line. */
export const titlesInStock = 41;

const byId = new Map(catalog.map((book) => [book.id, book]));

/**
 * Resolves a persisted cart id back to a book. Returns undefined for anything
 * no longer on the shelves — the cart is stored in the browser and outlives
 * the catalogue, so a miss is an expected state, not an error. This is the one
 * function `buildCart` needs, and the one the API will replace.
 */
export function getBookById(id: string): CatalogBook | undefined {
  return byId.get(id);
}

export const primaryNav = [
  { href: "/catalog", label: "Books" },
  { href: "/staff-picks", label: "Staff picks" },
  { href: "/orders", label: "Track order" },
];

export const footerColumns = [
  {
    heading: "Shop",
    links: [
      { href: "/catalog", label: "Books" },
    ],
  },
  {
    heading: "Orders",
    links: [
      { href: "/orders", label: "Track an order" },
      { href: "/refund-policy", label: "Refund policy" },
      { href: "/privacy-policy", label: "Privacy policy" },
      { href: "/terms", label: "Terms & conditions" },
    ],
  },
  {
    heading: "Contact",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "mailto:info@nihonovaacademy.com", label: "info@nihonovaacademy.com" },
      {
        href: "https://maps.google.com/?q=Uttara,+Dhaka+1230",
        label: "Uttara, Dhaka 1230",
      },
      { href: "https://www.facebook.com/nihonovaacademy/", label: "Facebook" },
    ],
  },
];
