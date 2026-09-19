import Filters from "@/components/Filters";
import TimeSeries from "@/components/TimeSeries";
import { Panel } from "@/components/Panel";
import DbError from "@/components/DbError";
import EmptyPlant from "@/components/EmptyPlant";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  apparentPowerByMeter,
  bucketLabel,
  currentThdByMeter,
  frequencyByMeter,
  perPhaseActivePower,
  perPhaseCurrent,
  perPhasePowerFactor,
  perPhaseVoltage,
  pfByMeter,
  powerByMeter,
  reactivePowerByMeter,
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

    const [kw, kva, kvar, freq, pf, volts, ithd, phaseV, phaseI, phaseP, phasePf] =
      await Promise.all([
        powerByMeter(plant, allIds, win),
        apparentPowerByMeter(plant, allIds, win),
        reactivePowerByMeter(plant, allIds, win),
        frequencyByMeter(plant, allIds, win),
        pfByMeter(plant, allIds, win),
        voltageByMeter(plant, allIds, win),
        currentThdByMeter(plant, allIds, win),
        perPhaseVoltage(plant, win, meter),
        perPhaseCurrent(plant, win, meter),
        perPhaseActivePower(plant, win, meter),
        perPhasePowerFactor(plant, win, meter),
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

          <Panel title="Apparent power by meter (kVA)" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-kva"
              tableHref={`/chart/apparent-power${winQs ? `?${winQs}` : ""}`}
              series={kva}
              unit="kVA"
              decimals={1}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>

          <Panel title="Reactive power by meter (kVAr, derived from kVA & kW)" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-kvar"
              tableHref={`/chart/reactive-power${winQs ? `?${winQs}` : ""}`}
              series={kvar}
              unit="kVAr"
              decimals={1}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>

          <Panel title="Grid frequency by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-freq"
              tableHref={`/chart/frequency${winQs ? `?${winQs}` : ""}`}
              series={freq}
              unit="Hz"
              decimals={2}
              height={210}
              statLabel={stat}
              showBand={false}
              threshold={{ value: 50, label: "50 Hz NOMINAL", tone: "good" }}
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

          <Panel title={`Per-phase active power — ${meter}`} span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-php"
              tableHref={`/chart/per-phase-power?meter=${meter}${winQs ? `&${winQs}` : ""}`}
              series={phaseP}
              unit="kW"
              decimals={1}
              height={210}
              statLabel={stat}
              showBand={false}
            />
          </Panel>

          <Panel title={`Per-phase power factor — ${meter}`} span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="ov-phpf"
              tableHref={`/chart/per-phase-pf?meter=${meter}${winQs ? `&${winQs}` : ""}`}
              series={phasePf}
              unit=""
              decimals={3}
              height={210}
              statLabel={stat}
              showBand={false}
              threshold={{ value: 0.9, label: "0.90 REFERENCE", tone: "warn" }}
            />
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
