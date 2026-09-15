import Filters from "@/components/Filters";
import TimeSeries from "@/components/TimeSeries";
import { Panel } from "@/components/Panel";
import DbError from "@/components/DbError";
import EmptyPlant from "@/components/EmptyPlant";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  bucketLabel,
  currentThdByMeter,
  perPhaseCurrent,
  perPhaseVoltage,
  pfByMeter,
  powerByMeter,
  voltageByMeter,
  windowFromParams,
  windowParams,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; meter?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { win, warnings } = windowFromParams(sp);
  const winQs = windowParams(sp);
  const rangeForUi = typeof win === "string" ? win : "24h";

  try {
    const { plant, config } = await getSelectedPlant();
    const topo = await getTopology(plant);
    const allIds = topo.allIds;

    if (allIds.length === 0) {
      return (
        <>
          <Filters title="Overview" range={rangeForUi} warnings={warnings} />
          <EmptyPlant plantName={config?.name} />
        </>
      );
    }

    const meter = sp.meter && allIds.includes(sp.meter) ? sp.meter : (allIds[0] ?? "");

    if (sp.meter && !allIds.includes(sp.meter))
      warnings.push(`Unknown meter "${sp.meter}" — showing ${meter}.`);

    const [kw, pf, volts, ithd, phaseV, phaseI] = await Promise.all([
      powerByMeter(plant, allIds, win),
      pfByMeter(plant, allIds, win),
      voltageByMeter(plant, allIds, win),
      currentThdByMeter(plant, allIds, win),
      perPhaseVoltage(plant, win, meter),
      perPhaseCurrent(plant, win, meter),
    ]);

    const stat = bucketLabel(win);

    return (
      <>
        <Filters
          title="Overview"
          range={rangeForUi}
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
              tableHref={`/chart/power${winQs ? `?${winQs}` : ""}`}
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
              tableHref={`/chart/pf${winQs ? `?${winQs}` : ""}`}
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
              tableHref={`/chart/voltage${winQs ? `?${winQs}` : ""}`}
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
              tableHref={`/chart/current-thd${winQs ? `?${winQs}` : ""}`}
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
              tableHref={`/chart/per-phase-voltage?meter=${meter}${winQs ? `&${winQs}` : ""}`}
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
              tableHref={`/chart/per-phase-current?meter=${meter}${winQs ? `&${winQs}` : ""}`}
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
