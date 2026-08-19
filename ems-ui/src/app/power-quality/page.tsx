import Filters from "@/components/Filters";
import TimeSeries from "@/components/TimeSeries";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { getTopology } from "@/lib/topology";
import {
  bucketLabel,
  currentImbalance,
  currentThdByMeter,
  isRange,
  perPhaseCurrent,
  perPhaseVoltage,
  voltageImbalance,
  voltageThdByMeter,
  type RangeKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PowerQuality({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; meter?: string }>;
}) {
  const sp = await searchParams;
  const range: RangeKey = isRange(sp.range) ? sp.range : "24h";

  try {
    const topo = await getTopology();
    const allIds = topo.allIds;
    const meter = sp.meter && allIds.includes(sp.meter) ? sp.meter : (allIds[0] ?? "");

    const warnings: string[] = [];
    if (sp.range && !isRange(sp.range))
      warnings.push(`Ignored unknown range "${sp.range}" — showing 24H.`);
    if (sp.meter && !allIds.includes(sp.meter))
      warnings.push(`Unknown meter "${sp.meter}" — showing ${meter}.`);

    const [vthd, ithd, vimb, iimb, phaseV, phaseI] = await Promise.all([
      voltageThdByMeter(allIds, range),
      currentThdByMeter(allIds, range),
      voltageImbalance(allIds, range),
      currentImbalance(allIds, range),
      perPhaseVoltage(range, meter),
      perPhaseCurrent(range, meter),
    ]);

    const stat = bucketLabel(range);

    return (
      <>
        <Filters
          title="Power Quality"
          range={range}
          meters={allIds}
          meter={meter}
          warnings={warnings}
        />

        <Notice>
          <span>
            <strong className="font-medium text-foreground">
              These are diagnostic limits, not a compliance test.
            </strong>{" "}
            IEEE 519 applies at the point of common coupling, on 10-minute values at the
            95th percentile over a week, and limits current distortion as TDD against
            maximum demand load current — not as THD on each internal feeder. Use these
            lines to spot trends and outliers, not to make a compliance claim.
          </span>
        </Notice>

        <div className="grid grid-cols-12 gap-3 pb-4">
          <Panel title="Voltage THD by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="vthd"
              series={vthd}
              unit="%"
              decimals={2}
              height={210}
              zeroBased
              statLabel={stat}
              showBand={false}
              threshold={{ value: 8, label: "IEEE 519 LV 8%", tone: "warn" }}
            />
          </Panel>

          <Panel title="Current THD by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ithd"
              series={ithd}
              unit="%"
              decimals={2}
              height={210}
              zeroBased
              statLabel={stat}
              showBand={false}
              threshold={{ value: 8, label: "REFERENCE 8%", tone: "warn" }}
            />
          </Panel>

          <Panel title="Voltage imbalance by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="vimb"
              series={vimb}
              unit="%"
              decimals={2}
              height={210}
              zeroBased
              statLabel={stat}
              showBand={false}
              threshold={{ value: 2, label: "TARGET 2%", tone: "warn" }}
            />
          </Panel>

          <Panel title="Current imbalance by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="iimb"
              series={iimb}
              unit="%"
              decimals={2}
              height={210}
              zeroBased
              statLabel={stat}
              showBand={false}
              threshold={{ value: 10, label: "REVIEW 10%", tone: "warn" }}
            />
          </Panel>

          <Panel title={`Per-phase voltage — ${meter}`} span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="phv"
              series={phaseV}
              unit="V"
              decimals={1}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>

          <Panel title={`Per-phase current — ${meter}`} span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="phi"
              series={phaseI}
              unit="A"
              decimals={1}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
