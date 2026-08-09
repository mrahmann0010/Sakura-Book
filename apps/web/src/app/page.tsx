import Link from "next/link";

import { BookCard, BookGrid, BookScroller } from "@/components/domain";
import {
  PageShell,
  Section,
  Shell,
  SiteFooter,
  SiteHeader,
} from "@/components/layout";
import { LinkButton } from "@/components/ui";
import {
  footerColumns,
  primaryNav,
  recentlyAdded,
  staffPicks,
  titlesInStock,
} from "@/lib/books";

/* Placeholder landing page. Real pages are a separate pass — this one exists
   so the shells and cards have somewhere to be exercised in the app. */

export default function Home() {
  return (
    <PageShell
      header={
        <SiteHeader nav={primaryNav} activeHref="/" searchHref="/search" />
      }
      footer={
        <SiteFooter
          blurb="A small catalogue of books, chosen by hand and posted from Bristol."
          columns={footerColumns}
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      <Shell as="section" className="flex flex-col items-center py-20 text-center">
        <h1 className="max-w-measure-intro font-serif text-36 leading-[1.04] text-ink sm:text-48 lg:text-64">
          Books we have actually read
        </h1>
        <p className="mt-6 max-w-measure-lede text-body text-secondary">
          A small catalogue, chosen by hand and posted from Bristol. When a title
          sells out we take it down rather than order more.
        </p>
        <p className="eyebrow mt-8">{titlesInStock} titles in stock</p>
      </Shell>

      <Shell>
        <Section
          eyebrow="Freshly shelved"
          title="Recently added"
          action={<Link href="/catalog">All {titlesInStock} →</Link>}
        >
          <BookGrid>
            {recentlyAdded.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </BookGrid>

          <div className="mt-9 flex justify-center">
            <LinkButton href="/catalog" variant="secondary">
              See the whole catalogue
            </LinkButton>
          </div>
        </Section>
      </Shell>

      <Shell className="mt-20 lg:mt-section">
        <Section eyebrow="Second shelf" title="Staff picks">
          <BookScroller>
            {staffPicks.map((book) => (
              <BookCard key={book.id} book={book} showFlag={false} />
            ))}
          </BookScroller>
        </Section>
      </Shell>

      <div className="h-20 lg:h-section" />
    </PageShell>
  );
}
