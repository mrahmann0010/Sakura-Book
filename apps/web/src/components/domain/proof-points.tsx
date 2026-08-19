import { cn } from "@/lib/utils";

/**
 * The credibility band under the catalogue grid, per the Proof Points
 * Wireframe: three items of equal weight — a metric and two short claims —
 * separated by hairlines and nothing else.
 *
 * Deliberately not a Section: it carries no title, no action and no card. It
 * is a continuation of the grid above it, marked off by a single top rule, so
 * it takes the page background and its own padding rather than the block
 * rhythm every other section shares.
 *
 * Static by design — no icons, no accent, no hover, no motion. Hierarchy is
 * type size and whitespace, which is why the three items read as equals.
 */
export function ProofPoints({
  eyebrow,
  metric,
  metricLabel,
  points,
  className,
}: {
  /** Doubles as the section's accessible heading. */
  eyebrow: string;
  /** The one number, e.g. "2,000+". */
  metric: string;
  metricLabel: string;
  /** The two supporting claims. Exactly two — the band is a three-up. */
  points: [ProofPoint, ProofPoint];
  className?: string;
}) {
  return (
    <section
      className={cn("hairline bg-page pt-12 pb-14 lg:pt-18 lg:pb-20", className)}
      aria-labelledby="proof-points-title"
    >
      {/* Full-bleed band, catalogue-width content: the rule runs the width of
          the page, the type lines up with the grid above. `shell` rather than
          <Shell> so a domain component stays free of the layout barrel. */}
      <div className="shell">
        <h2
          id="proof-points-title"
          className="text-muted tracking-label text-11 font-mono leading-relaxed uppercase"
        >
          {eyebrow}
        </h2>

        {/* gap-0: the columns are divided by their own left rules, which sit in
          the 48px of internal padding rather than against the text. */}
        <dl className="mt-10 grid grid-cols-1 gap-0 lg:mt-12 lg:grid-cols-3">
          <div className={cell(true)}>
            <dt className="text-ink text-34 lg:text-42 font-serif leading-none">{metric}</dt>
            <dd className="text-secondary text-13 mt-4">{metricLabel}</dd>
          </div>

          {points.map((point) => (
            <div key={point.title} className={cell(false)}>
              <dt className="text-ink text-18 font-serif">{point.title}</dt>
              <dd className="max-w-measure-intro text-secondary text-body mt-4.5 text-pretty">
                {point.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export type ProofPoint = { title: string; body: string };

/**
 * Stacked, each item is separated from the one above by a top rule; from
 * desktop the rules turn vertical and the top rules go away. The first cell
 * has neither, and pays no left padding — its metric aligns with the eyebrow
 * and with the catalogue grid above.
 */
function cell(first: boolean) {
  return cn(
    first
      ? "lg:pr-12"
      : "hairline mt-9 pt-9 lg:mt-0 lg:border-t-0 lg:border-l lg:border-rule lg:px-12 lg:pt-0",
  );
}
