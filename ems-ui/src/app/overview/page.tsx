import Filters from "@/components/Filters";
import TimeSeries from "@/components/TimeSeries";
import { Panel } from "@/components/Panel";
import DbError from "@/components/DbError";
import { getTopology } from "@/lib/topology";
import {
  bucketLabel,
  currentThdByMeter,
  isRange,
  perPhaseCurrent,
  perPhaseVoltage,
  pfByMeter,
  powerByMeter,
  voltageByMeter,
  type RangeKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Overview({
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

    const [kw, pf, volts, ithd, phaseV, phaseI] = await Promise.all([
      powerByMeter(allIds, range),
      pfByMeter(allIds, range),
      voltageByMeter(allIds, range),
      currentThdByMeter(allIds, range),
      perPhaseVoltage(range, meter),
      perPhaseCurrent(range, meter),
    ]);

    const stat = bucketLabel(range);

    return (
      <>
        <Filters
          title="Overview"
          range={range}
          meters={allIds}
          meter={meter}
          warnings={warnings}
        />

        <div className="grid grid-cols-12 gap-3 pb-4">
          <Panel
            title="Active power by meter — incomer and sub-meters"
            span="col-span-12 lg:col-span-6"
          >
            <TimeSeries
              id="ov-kw"
              series={kw}
              unit="kW"
              decimals={0}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>

          <Panel title="Power factor by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-pf"
              series={pf}
              unit=""
              decimals={3}
              height={210}
              statLabel={stat}
              showBand={false}
              threshold={{ value: 0.9, label: "0.90 REFERENCE", tone: "warn" }}
            />
          </Panel>

          <Panel title="System average voltage by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-v"
              series={volts}
              unit="V"
              decimals={1}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>

          <Panel title="Current THD by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-thd"
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

          <Panel title={`Per-phase voltage — ${meter}`} span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-phv"
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
              id="ov-phi"
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
