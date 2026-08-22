"use client";

/**
 * A minimal, dependency-free bar chart for the KPI dashboard's two magnitude
 * series (the 12-month trend, the daily drill-down). One series, one hue —
 * the shop's own accent — so this needs no categorical palette or CVD
 * validation; that machinery is for telling multiple series apart by color,
 * and there is only ever one series here.
 *
 * Hover uses a native `<title>` per bar rather than a custom tooltip: cheap,
 * accessible to screen readers, and every caller pairs this with a plain
 * table underneath for the same data — the chart is the "at a glance" view,
 * the table is the accessible and exact one.
 */
export type BarPoint = {
  key: string;
  label: string;
  value: number;
  tooltip: string;
};

export function BarChart({
  points,
  height = 160,
  selectedKey,
  onSelect,
}: {
  points: BarPoint[];
  height?: number;
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const slot = 40;
  const barWidth = 26;
  const baseline = height - 22;

  return (
    <svg
      viewBox={`0 0 ${points.length * slot} ${height}`}
      preserveAspectRatio="none"
      className="h-40 w-full"
      role="img"
      aria-label="Bar chart — see the table below for exact figures"
    >
      <line
        x1={0}
        y1={baseline + 0.5}
        x2={points.length * slot}
        y2={baseline + 0.5}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      {points.map((point, index) => {
        const barHeight = Math.max(2, (point.value / max) * (baseline - 8));
        const x = index * slot + (slot - barWidth) / 2;
        const y = baseline - barHeight;
        const active = point.key === selectedKey;
        const dimmed = Boolean(selectedKey) && !active;

        return (
          <g
            key={point.key}
            onClick={onSelect ? () => onSelect(point.key) : undefined}
            className={onSelect ? "cursor-pointer" : undefined}
          >
            <title>{point.tooltip}</title>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill={active ? "var(--clay-deep)" : "var(--clay)"}
              opacity={dimmed ? 0.45 : 1}
            />
            <text
              x={x + barWidth / 2}
              y={height - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted)"
            >
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
