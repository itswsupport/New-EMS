import type { Heatmap } from "@/lib/queries";
import { fmt } from "@/lib/format";

/**
 * Load-profile heatmap: IST hour-of-day (columns 0–23) against date (rows,
 * newest on top), shaded by average plant kW. Reveals the daily load pattern —
 * shift starts, lunch dips, night base load — that a single trend line hides.
 *
 * Colour is a single-hue intensity ramp (faint = low, solid = peak) layered over
 * the neutral cell so it reads in both light and dark themes without color-mix.
 */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const istWeekday = (iso: string) =>
  new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

export default function LoadHeatmap({ data }: { data: Heatmap }) {
  if (data.days.length === 0 || data.maxKw <= 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        Not enough data yet to plot a load pattern for this window.
      </p>
    );
  }
  const intensity = (kw: number | null) =>
    kw === null ? null : 0.1 + 0.9 * Math.max(0, Math.min(1, kw / data.maxKw));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        {/* Hour axis */}
        <div className="grid grid-cols-[92px_repeat(24,1fr)] items-end gap-[2px] pb-1">
          <span />
          {HOURS.map((h) => (
            <span key={h} className="text-center text-[8.5px] leading-none text-muted-foreground">
              {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
        </div>

        {/* One row per date */}
        {data.days.map((d) => (
          <div key={d.date} className="grid grid-cols-[92px_repeat(24,1fr)] items-center gap-[2px] py-[1px]">
            <span className="truncate pr-2 text-right text-[10px] text-muted-foreground">
              {istWeekday(d.date)}
            </span>
            {d.cells.map((kw, h) => {
              const t = intensity(kw);
              return (
                <div
                  key={h}
                  title={`${istWeekday(d.date)} ${String(h).padStart(2, "0")}:00 — ${
                    kw === null ? "no data" : `${fmt(kw, 0)} kW`
                  }`}
                  className="relative h-[13px] overflow-hidden rounded-[2px] bg-secondary"
                >
                  {t !== null && (
                    <div
                      className="absolute inset-0"
                      style={{ background: "var(--chart-1)", opacity: t }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="mt-2.5 flex items-center gap-2 text-[9.5px] text-muted-foreground">
          <span>0 kW</span>
          <div className="flex h-2.5 w-32 overflow-hidden rounded-[2px] bg-secondary">
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                className="h-full flex-1"
                style={{ background: "var(--chart-1)", opacity: 0.1 + 0.9 * (i / 11) }}
              />
            ))}
          </div>
          <span>{fmt(data.maxKw, 0)} kW peak</span>
        </div>
      </div>
    </div>
  );
}
