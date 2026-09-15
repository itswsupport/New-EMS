import Filters from "@/components/Filters";
import TimeSeries from "@/components/TimeSeries";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import EmptyPlant from "@/components/EmptyPlant";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  bucketLabel,
  currentImbalance,
  currentThdByMeter,
  perPhaseCurrent,
  perPhaseVoltage,
  voltageImbalance,
  voltageThdByMeter,
  windowFromParams,
  windowParams,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PowerQuality({
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
          <Filters title="Power Quality" range={rangeForUi} warnings={warnings} />
          <EmptyPlant plantName={config?.name} />
        </>
      );
    }

    const meter = sp.meter && allIds.includes(sp.meter) ? sp.meter : (allIds[0] ?? "");

    if (sp.meter && !allIds.includes(sp.meter))
      warnings.push(`Unknown meter "${sp.meter}" — showing ${meter}.`);

    const [vthd, ithd, vimb, iimb, phaseV, phaseI] = await Promise.all([
      voltageThdByMeter(plant, allIds, win),
      currentThdByMeter(plant, allIds, win),
      voltageImbalance(plant, allIds, win),
      currentImbalance(plant, allIds, win),
      perPhaseVoltage(plant, win, meter),
      perPhaseCurrent(plant, win, meter),
    ]);

    const stat = bucketLabel(win);

    return (
      <>
        <Filters
          title="Power Quality"
          range={rangeForUi}
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
              tableHref={`/chart/voltage-thd${winQs ? `?${winQs}` : ""}`}
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

          <Panel title="Voltage imbalance by meter" span="col-span-12 lg:col-span-6">
            <TimeSeries
              id="vimb"
              tableHref={`/chart/voltage-imbalance${winQs ? `?${winQs}` : ""}`}
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
              tableHref={`/chart/current-imbalance${winQs ? `?${winQs}` : ""}`}
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
              id="phi"
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
