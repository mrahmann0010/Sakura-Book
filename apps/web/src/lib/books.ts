import type { BookSummary } from "@/components/domain";

/* Placeholder catalogue. Stands in for the API until apps/api exists — the
   shape is BookSummary, which is what every book-shaped component reads. */

/** Six titles, freshly shelved. */
export const recentlyAdded: BookSummary[] = [
  {
    id: "the-quiet-shelf",
    title: "The Quiet Shelf",
    author: "Ana Belén Ruiz",
    price: "£14.00",
    href: "/books/the-quiet-shelf",
    flag: "editors-pick",
  },
  {
    id: "letters-to-a-cartographer",
    title: "Letters to a Cartographer",
    author: "Hiroshi Tanabe",
    price: "£11.50",
    href: "/books/letters-to-a-cartographer",
    flag: "last-copy",
  },
  {
    id: "salt-and-almanac",
    title: "Salt and Almanac",
    author: "Marguerite Okonkwo",
    price: "£16.00",
    href: "/books/salt-and-almanac",
    flag: "signed",
  },
  {
    id: "a-winter-of-small-repairs",
    title: "A Winter of Small Repairs",
    author: "Tomas Lindqvist",
    price: "£12.00",
    href: "/books/a-winter-of-small-repairs",
  },
  {
    id: "the-long-field",
    title: "The Long Field",
    author: "Ide Ó Cuinneagáin",
    price: "£13.50",
    href: "/books/the-long-field",
    soldOut: true,
  },
  {
    id: "nine-bridges",
    title: "Nine Bridges",
    author: "Petra Sandoval",
    price: "£15.00",
    href: "/books/nine-bridges",
  },
];

/** The second shelf. Same card, no badge. */
export const staffPicks: BookSummary[] = [
  {
    id: "an-orchard-in-reverse",
    title: "An Orchard in Reverse",
    author: "Cordelia Nwachukwu",
    price: "£13.00",
    href: "/books/an-orchard-in-reverse",
  },
  {
    id: "the-weather-in-other-rooms",
    title: "The Weather in Other Rooms",
    author: "Jonas Ferreira",
    price: "£10.50",
    href: "/books/the-weather-in-other-rooms",
    format: "Paperback",
  },
  {
    id: "everything-we-kept",
    title: "Everything We Kept",
    author: "Su-jin Park",
    price: "£17.00",
    href: "/books/everything-we-kept",
    format: "Paperback",
  },
];

/** Shown on the hero count line. */
export const titlesInStock = 41;

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
