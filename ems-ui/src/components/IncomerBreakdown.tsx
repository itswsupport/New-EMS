import type { PlantBreakdown } from "@/lib/queries";
import { fmt } from "@/lib/format";

/**
 * Plant energy split across its independent incomers (root meters).
 *
 * Unlike a parent-vs-children balance, these bars do not have an "unattributed"
 * remainder: the roots don't overlap, so their shares sum to 100% of the plant
 * total by construction. This is the honest picture of a multi-incomer plant —
 * how much of the total load comes in on each feed.
 */
export default function IncomerBreakdown({
  data,
  unit = "kWh",
}: {
  data: PlantBreakdown;
  unit?: string;
}) {
  const total = data.totalKwh ?? 0;
  const width = (v: number | null) =>
    total > 0 && v !== null ? `${Math.max(0, Math.min(100, (v / total) * 100))}%` : "0%";

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[11px] text-muted-foreground">Plant total</span>
        <span className="text-[18px] font-medium tnum">
          {fmt(data.totalKwh, 0)} <span className="text-[11px]">{unit}</span>
        </span>
      </div>

      {data.incomers.map((c, i) => (
        <div
          key={c.deviceId}
          className="grid grid-cols-[86px_1fr_104px] items-center gap-3 border-b border-border py-2 last:border-b-0"
        >
          <span className="truncate text-[11px] text-foreground">{c.deviceId}</span>
          <div className="h-3 overflow-hidden rounded-[3px] bg-secondary">
            <div
              className="h-full rounded-r-[3px]"
              style={{ width: width(c.kwh), background: `var(--chart-${(i % 3) + 1})` }}
            />
          </div>
          <span className="text-right tnum">
            <span className="text-[12px] font-medium">{fmt(c.kwh, 0)}</span>
            <span className="ml-1 text-[10px] text-muted-foreground">{fmt(c.pct, 1)}%</span>
          </span>
        </div>
      ))}

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        {data.incomers.length > 1 ? (
          <>
            This plant has {data.incomers.length} independent utility incomers. Each bar is
            one incomer&apos;s share of total plant energy; their feeds don&apos;t overlap,
            so the plant total is their sum. Compared on energy, not instantaneous power.
          </>
        ) : (
          <>A single utility incomer carries the whole plant&apos;s energy.</>
        )}
      </p>
    </>
  );
}
