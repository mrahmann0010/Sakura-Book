import { cn } from "@/lib/utils";

/**
 * The credibility band under the catalogue grid, per the Proof Points
 * Wireframe: a metric plus a small set of short claims, all of equal weight,
 * separated by hairlines and nothing else.
 *
 * Deliberately not a Section: it carries no title, no action and no card. It
 * is a continuation of the grid above it, marked off by a single top rule, so
 * it takes the page background and its own padding rather than the block
 * rhythm every other section shares.
 *
 * Static by design — no icons, no accent, no hover, no motion. Hierarchy is
 * type size and whitespace, which is why the items read as equals.
 *
 * The band supports either two or three supporting points (three or four
 * cells total, metric included) because locales carry different copy —
 * three cells lays out as a stacked list on mobile and a 3-up row on
 * desktop; four cells lays out as a 2x2 grid at every width. Anything other
 * than two or three points has no defined layout.
 */
export function ProofPoints({
  eyebrow,
  metric,
  metricLabel,
  metricBody,
  points,
  className,
}: {
  /** Doubles as the section's accessible heading. */
  eyebrow: string;
  /** The one number, e.g. "2,000+". */
  metric: string;
  metricLabel: string;
  /** Optional supporting line under the metric label. */
  metricBody?: string;
  /** The supporting claims — two or three. */
  points: [ProofPoint, ProofPoint] | [ProofPoint, ProofPoint, ProofPoint];
  className?: string;
}) {
  const total = points.length + 1;

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

        <dl
          className={cn(
            "mt-10 grid gap-x-8 gap-y-0 lg:mt-12 lg:gap-0",
            total === 4 ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-3",
          )}
        >
          <div className={cell(0, total)}>
            <dt className="text-ink text-34 lg:text-42 font-serif leading-none">{metric}</dt>
            <dd className="text-secondary text-13 mt-4">{metricLabel}</dd>
            {metricBody ? (
              <dd className="max-w-measure-intro text-secondary text-body mt-4.5 text-pretty">
                {metricBody}
              </dd>
            ) : null}
          </div>

          {points.map((point, i) => (
            <div key={point.title} className={cell(i + 1, total)}>
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
 * Three cells: stacked on mobile, each separated from the one above by a top
 * rule; from desktop the rules turn vertical and the top rules go away. The
 * first cell has neither, and pays no left padding — its metric aligns with
 * the eyebrow and with the catalogue grid above.
 *
 * Four cells: a 2x2 grid at every width — a top rule between the two rows, a
 * left rule between the two columns, crossing in the middle.
 */
function cell(index: number, total: number) {
  if (total === 4) {
    const isSecondRow = index >= 2;
    const isRightColumn = index % 2 === 1;

    return cn(
      isSecondRow && "hairline mt-9 pt-9",
      isRightColumn ? "border-rule border-l pl-6" : "pr-6",
    );
  }

  return cn(
    index === 0
      ? "lg:pr-12"
      : "hairline mt-9 pt-9 lg:mt-0 lg:border-t-0 lg:border-l lg:border-rule lg:px-12 lg:pt-0",
  );
}
