import type { ReactNode } from "react";

export type Tone = "good" | "warn" | "crit" | "plain";

const TONE: Record<Tone, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  crit: "var(--bad)",
  plain: "var(--brand)",
};

/**
 * A hero number. No plot, so no hover layer — the sub-line carries the context
 * a sparkline would otherwise imply.
 */
export default function StatTile({
  label,
  value,
  unit,
  sub,
  tone = "plain",
  status,
  span = "col-span-12 sm:col-span-6 xl:col-span-3",
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
  status?: string;
  span?: string;
}) {
  const color = TONE[tone];

  return (
    <section
      className={`${span} bg-card border border-border rounded-lg p-4 min-w-0`}
    >
      <h2 className="text-[11px] font-medium text-muted-foreground tracking-wide">
        {label}
      </h2>

      <div className="mt-2.5 flex items-baseline gap-1.5 tnum">
        <span
          className="text-[34px] leading-none font-medium tracking-tight"
          style={{ color }}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[12px] text-muted-foreground">{unit}</span>
        )}
      </div>

      {status && (
        <div
          className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] font-medium"
          style={{ color }}
        >
          <span
            className="inline-block w-[6px] h-[6px] rounded-full"
            style={{ background: color }}
          />
          {status}
        </div>
      )}

      {sub && (
        <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground">
          {sub}
        </p>
      )}
    </section>
  );
}
