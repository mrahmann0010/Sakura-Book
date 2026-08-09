/* Placeholder catalogue. Stands in for the API until apps/api exists — the
   shape is what the landing page and catalog both read. */

export type BookFlag = "editors-pick" | "last-copy" | "signed";

export type Book = {
  slug: string;
  title: string;
  author: string;
  price: string;
  /** Metadata badge shown between cover and title. At most one per card. */
  flag?: BookFlag;
  /** Sold-out cards drop to 55% and trade the price for the words. */
  inStock: boolean;
};

export const flagLabels: Record<BookFlag, string> = {
  "editors-pick": "Editor's pick",
  "last-copy": "Last copy",
  signed: "Signed",
};

/** Six titles, freshly shelved. The first two rows of the landing page. */
export const recentlyAdded: Book[] = [
  {
    slug: "the-quiet-shelf",
    title: "The Quiet Shelf",
    author: "Ana Belén Ruiz",
    price: "£14.00",
    flag: "editors-pick",
    inStock: true,
  },
  {
    slug: "letters-to-a-cartographer",
    title: "Letters to a Cartographer",
    author: "Hiroshi Tanabe",
    price: "£11.50",
    flag: "last-copy",
    inStock: true,
  },
  {
    slug: "salt-and-almanac",
    title: "Salt and Almanac",
    author: "Marguerite Okonkwo",
    price: "£16.00",
    flag: "signed",
    inStock: true,
  },
  {
    slug: "a-winter-of-small-repairs",
    title: "A Winter of Small Repairs",
    author: "Tomas Lindqvist",
    price: "£12.00",
    inStock: true,
  },
  {
    slug: "the-long-field",
    title: "The Long Field",
    author: "Ide Ó Cuinneagáin",
    price: "£13.50",
    inStock: false,
  },
  {
    slug: "nine-bridges",
    title: "Nine Bridges",
    author: "Petra Sandoval",
    price: "£15.00",
    inStock: true,
  },
];

/** The second shelf. Same card, no badge. */
export const staffPicks: Book[] = [
  {
    slug: "an-orchard-in-reverse",
    title: "An Orchard in Reverse",
    author: "Cordelia Nwachukwu",
    price: "£13.00",
    inStock: true,
  },
  {
    slug: "the-weather-in-other-rooms",
    title: "The Weather in Other Rooms",
    author: "Jonas Ferreira",
    price: "£10.50",
    inStock: true,
  },
  {
    slug: "everything-we-kept",
    title: "Everything We Kept",
    author: "Su-jin Park",
    price: "£17.00",
    inStock: true,
  },
];

/** Shown on the hero count line. */
export const titlesInStock = 41;
