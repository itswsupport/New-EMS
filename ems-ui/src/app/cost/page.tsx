import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import TimeSeries from "@/components/TimeSeries";
import DemandBars from "@/components/DemandBars";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { fmt, rupees } from "@/lib/format";
import { getTopology } from "@/lib/topology";
import {
  bucketLabel,
  coincidentMaxDemand,
  costByMeter,
  isRange,
  pfByMeter,
  pfStats,
  RANGES,
  rangeTouchesCorruptWindow,
  reactiveEnergyByMeter,
  type RangeKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const TARIFF = Number(process.env.NEXT_PUBLIC_TARIFF_INR_PER_KVAH ?? 10.5);
const CONTRACT = Number(process.env.NEXT_PUBLIC_CONTRACT_KVA ?? 300);
const BLOCK_MIN = Number(process.env.NEXT_PUBLIC_DEMAND_BLOCK_MINUTES ?? 30);

export default async function CostDemand({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range: RangeKey = isRange(sp.range) ? sp.range : "24h";
  const warnings =
    sp.range && !isRange(sp.range)
      ? [`Ignored unknown range "${sp.range}" — showing 24H.`]
      : [];

  try {
    const topo = await getTopology();
    const rootIds = topo.rootIds;
    const allIds = topo.allIds;
    const mainId = rootIds[0];
    const childIds = topo.childrenOf(mainId).map((n) => n.id);

    const [costs, demand, pf, pfs, reactive] = await Promise.all([
      costByMeter(allIds, range, TARIFF),
      coincidentMaxDemand(rootIds, range, BLOCK_MIN),
      pfByMeter(allIds, range),
      pfStats(allIds, range),
      reactiveEnergyByMeter(allIds, range),
    ]);

    const root = costs.find((c) => c.deviceId === mainId);
    const rootKwh = root?.kwh ?? null;
    const rootCost = root?.cost ?? null;

    // Sub-meter rupees are a SHARE of the incomer's bill, never an addition to it.
    const allocation = childIds.map((id) => {
      const c = costs.find((x) => x.deviceId === id);
      const share = rootKwh && c?.kwh != null ? c.kwh / rootKwh : null;
      return {
        deviceId: id,
        kwh: c?.kwh ?? null,
        pf: c?.pf ?? null,
        share,
        cost: share !== null && rootCost !== null ? rootCost * share : null,
      };
    });
    const allocatedShare = allocation.reduce((a, r) => a + (r.share ?? 0), 0);
    const unattributedShare = 1 - allocatedShare;

    return (
      <>
        <Filters title="Cost & Demand" range={range} warnings={warnings} />

        <Notice>
          <span>
            <strong className="font-medium text-foreground">
              One bill, allocated — not three bills added up.
            </strong>{" "}
            The utility meters <code className="normal-case">{mainId}</code>, so that is
            the cost. Sub-meter rows below are that same cost apportioned by energy
            share for internal chargeback; they are not additional spend.
          </span>
        </Notice>

        <Notice>
          <span>
            <strong className="font-medium text-foreground">
              kVAh is derived as kWh ÷ PF
            </strong>
            , not from the meter&apos;s reactive counter.{" "}
            <code className="normal-case">reactive_energy</code> currently reads the
            capacitive register, which barely moves on an inductive plant, so the
            textbook <code className="normal-case">sqrt(kWh² + kVArh²)</code> form
            collapses to kWh. A flat ₹{TARIFF}/kVAh is also an energy proxy, not a
            tariff — it excludes demand charges, TOD and duty.
          </span>
        </Notice>

        {rangeTouchesCorruptWindow(range) && (
          <Notice>
            <span>
              <strong className="font-medium text-foreground">
                This range includes corrupted energy data
              </strong>{" "}
              (14–18 Aug). Cost and kVAh below are not usable for billing over this
              window.
            </span>
          </Notice>
        )}

        <div className="grid grid-cols-12 gap-3 pb-4">
          <StatTile
            label={`Utility-billed cost — ${RANGES[range].label}`}
            value={rupees(rootCost)}
            span="col-span-12 lg:col-span-4"
            sub={`${fmt(root?.kvah ?? null, 0)} kVAh at ₹${TARIFF}/kVAh · ${fmt(rootKwh, 0)} kWh at the incomer`}
          />

          <Panel
            title={`Maximum demand — coincident, ${BLOCK_MIN}-minute blocks`}
            span="col-span-12 lg:col-span-8"
          >
            <DemandBars demand={demand} contractKva={CONTRACT} rootIds={rootIds} />
          </Panel>

          <Panel title="Power factor" span="col-span-12 lg:col-span-7">
            <TimeSeries
              id="pf-trend"
              series={pf}
              unit=""
              decimals={3}
              height={230}
              statLabel={bucketLabel(range)}
              showBand={false}
              threshold={{ value: 0.9, label: "0.90 REFERENCE", tone: "warn" }}
            />
            <table className="table table-bordered mt-3 text-[11px] tnum">
              <thead>
                <tr>
                  <th className="text-left">Meter</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Average</th>
                  <th className="text-right">Time below 0.90</th>
                </tr>
              </thead>
              <tbody>
                {pfs.map((s) => (
                  <tr key={s.deviceId}>
                    <td>{s.deviceId}</td>
                    <td className="text-right">{fmt(s.min, 3)}</td>
                    <td className="text-right">{fmt(s.avg, 3)}</td>
                    <td
                      className={`text-right ${(s.pctBelow ?? 0) > 50 ? "text-bad" : ""}`}
                    >
                      {fmt(s.pctBelow, 0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              0.90 is an engineering reference, not a billing threshold — under kVAh
              billing a poor power factor is already priced as inflated kVAh rather
              than a separate penalty line. Minimum and time-below matter here;
              a maximum does not.
            </p>
          </Panel>

          <Panel
            title={`Cost allocation — ${RANGES[range].label}`}
            span="col-span-12 lg:col-span-5"
          >
            <table className="table table-bordered table-striped text-[11px] tnum">
              <thead>
                <tr>
                  <th className="text-left">Meter</th>
                  <th className="text-right">kWh</th>
                  <th className="text-right">Share</th>
                  <th className="text-right">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {allocation.map((r) => (
                  <tr key={r.deviceId}>
                    <td>{r.deviceId}</td>
                    <td className="text-right">{fmt(r.kwh, 0)}</td>
                    <td className="text-right">
                      {r.share === null ? "—" : fmt(r.share * 100, 1)}%
                    </td>
                    <td className="text-right">{rupees(r.cost)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="text-muted-foreground">Unattributed</td>
                  <td className="text-right">
                    {fmt(
                      rootKwh === null
                        ? null
                        : rootKwh - allocation.reduce((a, r) => a + (r.kwh ?? 0), 0),
                      0,
                    )}
                  </td>
                  <td className="text-right">{fmt(unattributedShare * 100, 1)}%</td>
                  <td className="text-right">
                    {rupees(rootCost === null ? null : rootCost * unattributedShare)}
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">{mainId} (billed)</td>
                  <td className="text-right font-medium">{fmt(rootKwh, 0)}</td>
                  <td className="text-right font-medium">100%</td>
                  <td className="text-right font-medium">{rupees(rootCost)}</td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Reactive energy counter"
            note="Unverified register — capacitive, not inductive"
            span="col-span-12"
          >
            <TimeSeries
              id="reactive"
              series={reactive}
              unit="kVArh"
              decimals={0}
              height={180}
              statLabel={bucketLabel(range)}
              showBand={false}
            />
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              This is a cumulative counter plotted raw, so it reads as flat lines — it
              is here for traceability, not analysis. It will become useful once the
              inductive register is identified.
            </p>
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
