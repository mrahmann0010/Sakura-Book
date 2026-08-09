import Link from "next/link";

/* Tinted block, 12px radius, 2fr 1fr 1fr 1fr with a 40px gutter. Column heads
   are mono eyebrows. Same on every page. */

const columns = [
  {
    heading: "Browse",
    links: [
      { href: "/catalog", label: "Everything in stock" },
      { href: "/staff-picks", label: "Staff picks" },
      { href: "/catalog?sort=new", label: "Recently added" },
    ],
  },
  {
    heading: "Orders",
    links: [
      { href: "/orders", label: "Track an order" },
      { href: "/shipping", label: "Shipping" },
      { href: "/returns", label: "Returns" },
    ],
  },
  {
    heading: "Shop",
    links: [
      { href: "/about", label: "About" },
      { href: "/visit", label: "Visit us" },
      { href: "mailto:hello@marginalia.example", label: "Email" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="shell pb-14">
      <div className="grid gap-10 rounded-container bg-tint p-8 sm:grid-cols-2 sm:p-12 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:p-14">
        <div>
          <p className="wordmark">Marginalia</p>
          <p className="mt-4 max-w-[28ch] text-caption text-secondary">
            A small catalogue of books, chosen by hand and posted from Bristol.
            Everything listed is a book we have on the shelf.
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.heading}>
            <p className="eyebrow">{column.heading}</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-13.5 text-secondary hover:text-clay">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="eyebrow mt-8">© {new Date().getFullYear()} Marginalia Books</p>
    </footer>
  );
}
