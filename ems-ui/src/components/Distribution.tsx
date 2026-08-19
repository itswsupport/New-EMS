import type { Distribution as Dist } from "@/lib/queries";
import { fmt } from "@/lib/format";

/**
 * Energy balance for one node against its direct children.
 *
 * The remainder — what the incomer measured minus what its sub-meters account for —
 * is the number an energy audit actually asks for: distribution loss plus unmetered
 * load. It is also the check that catches a mis-declared hierarchy, because a
 * negative remainder means the children cannot physically sit under this parent.
 */
export default function Distribution({
  dist,
  unit = "kWh",
}: {
  dist: Dist;
  unit?: string;
}) {
  const total = dist.nodeKwh ?? 0;
  const width = (v: number | null) =>
    total > 0 && v !== null ? `${Math.max(0, Math.min(100, (v / total) * 100))}%` : "0%";

  const negative = (dist.unattributedKwh ?? 0) < 0;

  const rows = [
    ...dist.children.map((c, i) => ({
      key: c.deviceId,
      label: c.deviceId,
      kwh: c.kwh,
      pct: c.pct,
      color: `var(--chart-${(i % 3) + 1})`,
    })),
    {
      key: "__unattributed",
      label: "Unattributed",
      kwh: dist.unattributedKwh,
      pct: dist.unattributedPct,
      color: negative ? "var(--bad)" : "var(--muted-foreground)",
    },
  ];

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[11px] text-muted-foreground">{dist.nodeId} measured</span>
        <span className="text-[18px] font-medium tnum">
          {fmt(dist.nodeKwh, 0)} <span className="text-[11px]">{unit}</span>
        </span>
      </div>

      {rows.map((r) => (
        <div
          key={r.key}
          className="grid grid-cols-[86px_1fr_104px] items-center gap-3 border-b border-border py-2 last:border-b-0"
        >
          <span
            className={`truncate text-[11px] ${
              r.key === "__unattributed" ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {r.label}
          </span>
          <div className="h-3 overflow-hidden rounded-[3px] bg-secondary">
            <div className="h-full rounded-r-[3px]" style={{ width: width(r.kwh), background: r.color }} />
          </div>
          <span className="text-right tnum">
            <span className="text-[12px] font-medium">{fmt(r.kwh, 0)}</span>
            <span className="ml-1 text-[10px] text-muted-foreground">
              {fmt(r.pct, 1)}%
            </span>
          </span>
        </div>
      ))}

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        {negative ? (
          <span className="text-bad">
            Sub-meters exceed the incomer, which is not physically possible — check the
            declared hierarchy or a CT ratio.
          </span>
        ) : (
          <>
            Unattributed is distribution loss plus any load on {dist.nodeId} that no
            sub-meter sees. Compared on energy, not instantaneous power, because poll
            skew between meters makes minute-level ratios unreliable.
          </>
        )}
      </p>
    </>
  );
}
