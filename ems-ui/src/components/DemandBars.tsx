import type { DemandResult } from "@/lib/queries";
import { fmt } from "@/lib/format";

const istBlock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";

/**
 * Maximum demand against the contract.
 *
 * Only the coincident figure is compared to the contract: contract demand is a
 * property of the utility service connection, not of an internal feeder, so a
 * "meter07 is at 92% of contract" reading is meaningless. Per-meter peaks are shown
 * underneath purely as a diversity diagnostic and are deliberately NOT summed —
 * they occur at different times, so their sum overstates plant demand.
 */
export default function DemandBars({
  demand,
  contractKva,
  rootIds,
}: {
  demand: DemandResult;
  contractKva: number;
  rootIds: string[];
}) {
  const kva = demand.coincidentKva;
  const pct = kva === null ? null : (kva / contractKva) * 100;
  const scaleMax = Math.max(contractKva * 1.15, kva ?? 0, 1);
  const pos = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;

  const tone =
    pct === null ? "var(--muted-foreground)"
    : pct >= 100 ? "var(--bad)"
    : pct >= 85 ? "var(--warn)"
    : "var(--good)";

  const sumOfPeaks = demand.perDevice.reduce((a, d) => a + (d.kva ?? 0), 0);

  return (
    <>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[24px] font-medium tnum" style={{ color: tone }}>
          {fmt(kva, 0)} <span className="text-[12px]">kVA</span>
        </span>
        <span className="text-[11px] tnum" style={{ color: tone }}>
          {fmt(pct, 0)}% of {contractKva} kVA contract
        </span>
      </div>

      <div className="relative mb-1.5 h-3.5 overflow-hidden rounded-[3px] bg-secondary">
        <div
          className="absolute inset-y-0 left-0 rounded-r-[3px]"
          style={{ width: pos(kva ?? 0), background: tone }}
        />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-foreground"
          style={{ left: pos(contractKva) }}
        />
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Coincident demand across {rootIds.join(", ")} — the summed load averaged over
        fixed {demand.blockMinutes}-minute clock-aligned blocks, peaking at{" "}
        <b className="font-medium text-foreground">{istBlock(demand.atBlock)} IST</b>.
        The rule marks the contract.
      </p>

      {demand.perDevice.length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="mb-1.5 text-[10px] text-muted-foreground">
            Individual peaks — diagnostic only, not additive
          </p>
          <table className="table text-[11px] tnum">
            <tbody>
              {demand.perDevice.map((d) => (
                <tr key={d.deviceId}>
                  <td className="py-1">{d.deviceId}</td>
                  <td className="py-1 text-right">{fmt(d.kva, 0)} kVA</td>
                  <td className="py-1 text-right text-muted-foreground">
                    {istBlock(d.atBlock)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            These sum to {fmt(sumOfPeaks, 0)} kVA, above the coincident{" "}
            {fmt(kva, 0)} kVA, because the peaks do not happen at the same moment.
            The coincident figure is the one that bills.
          </p>
        </div>
      )}
    </>
  );
}
