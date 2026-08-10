import type { BookSummary } from "@/components/domain";

/* Placeholder catalogue. Stands in for the API until apps/api exists — the
   shape is BookSummary, which is what every book-shaped component reads. */

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
    price: "£14.00",
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
    price: "£11.50",
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
    price: "£16.00",
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
    price: "£12.00",
    href: "/books/a-winter-of-small-repairs",
    genre: "fiction",
    rating: 4.1,
    ratingCount: 96,
  },
  {
    id: "the-long-field",
    title: "The Long Field",
    author: "Ide Ó Cuinneagáin",
    price: "£13.50",
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
    price: "£15.00",
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
    price: "£13.00",
    href: "/books/an-orchard-in-reverse",
    genre: "poetry",
    rating: 4.7,
    ratingCount: 88,
  },
  {
    id: "the-weather-in-other-rooms",
    title: "The Weather in Other Rooms",
    author: "Jonas Ferreira",
    price: "£10.50",
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
    price: "£17.00",
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
      { href: "/catalog?sort=new", label: "New this month" },
      { href: "/gift-cards", label: "Gift cards" },
    ],
  },
  {
    heading: "Orders",
    links: [
      { href: "/orders", label: "Track an order" },
      { href: "/delivery", label: "Delivery" },
      { href: "/returns", label: "Returns" },
    ],
  },
  {
    heading: "Contact",
    links: [
      { href: "mailto:hello@marginalia.example", label: "hello@marginalia.co" },
      { href: "/visit", label: "Visit us" },
      { href: "https://instagram.com", label: "Instagram" },
    ],
  },
];
