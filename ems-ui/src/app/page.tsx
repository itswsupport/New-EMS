import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import TimeSeries from "@/components/TimeSeries";
import Distribution from "@/components/Distribution";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { apparentEnergy, energy, fmt, power } from "@/lib/format";
import { getTopology } from "@/lib/topology";
import {
  bucketLabel,
  distributionFor,
  metersOnline,
  plantActivePowerKw,
  plantEnergyKvah,
  plantPowerFactor,
  plantPowerSeries,
  powerByMeter,
  rangeTouchesCorruptWindow,
  winLabel,
  windowFromParams,
  windowParams,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlantRollup({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { win, warnings } = windowFromParams(sp);
  const winQs = windowParams(sp);
  const rangeForUi = typeof win === "string" ? win : "24h";

  try {
    const topo = await getTopology();
    const rootIds = topo.rootIds;
    const allIds = topo.allIds;
    const mainId = rootIds[0];
    const childIds = topo.childrenOf(mainId).map((n) => n.id);

    const [kw, energyToday, pf, meters, plantSeries, byMeter, dist] = await Promise.all([
      plantActivePowerKw(rootIds),
      plantEnergyKvah(rootIds, win),
      plantPowerFactor(rootIds),
      metersOnline(allIds),
      plantPowerSeries(rootIds, win),
      powerByMeter(allIds, win),
      distributionFor(mainId, childIds, win),
    ]);

    const p = power(kw);
    const e = apparentEnergy(energyToday.kvah);
    const eActive = energy(energyToday.kwh);
    const pfTone = pf === null ? "plain" : pf > 0.95 ? "good" : pf >= 0.9 ? "warn" : "crit";
    const pfStatus =
      pf === null
        ? undefined
        : pf > 0.95
          ? "Comfortably above 0.90"
          : pf >= 0.9
            ? "At or just above 0.90"
            : "Below 0.90";

    return (
      <>
        <Filters title="Plant Rollup" range={rangeForUi} warnings={warnings} />

        <Notice>
          <span>
            <strong className="font-medium text-foreground">
              Totals are the incomer&apos;s, not the sum of all meters.
            </strong>{" "}
            <code className="normal-case">{mainId}</code> is the utility incomer and{" "}
            {childIds.join(", ")} sit downstream of it, so their consumption is already
            inside its reading. Summing all of them would double-count.
          </span>
        </Notice>

        {rangeTouchesCorruptWindow(win) && (
          <Notice>
            <span>
              <strong className="font-medium text-foreground">
                Energy figures in this range are unreliable.
              </strong>{" "}
              A register probe on 14 Aug corrupted{" "}
              <code className="normal-case">active_energy</code> until 18 Aug 10:20 IST.
              Power, power factor and current are unaffected.
            </span>
          </Notice>
        )}

        <div className="grid grid-cols-12 gap-3 pb-4">
          <StatTile
            label="Plant active power"
            value={p.value}
            unit={p.unit}
            sub={`Incomer ${mainId}, latest 30s reading`}
          />
          <StatTile
            label="Plant energy"
            value={e.value}
            unit={e.unit}
            sub={`${eActive.value} ${eActive.unit} active (÷ PF) · ${winLabel(win)}`}
          />
          <StatTile
            label="Plant power factor"
            value={pf === null ? "—" : fmt(pf, 3)}
            tone={pfTone}
            status={pfStatus}
            sub="15-minute load-weighted"
          />
          <StatTile
            label="Meters reporting"
            value={String(meters.online)}
            unit={`of ${meters.total}`}
            tone={meters.online >= meters.total ? "good" : "crit"}
            status={meters.online >= meters.total ? "All reporting" : "Meter missing"}
            sub="Seen in the last 60 seconds"
          />

          <Panel
            title={`Where the energy goes — ${mainId} against its sub-meters`}
            span="col-span-12 lg:col-span-4"
          >
            <Distribution dist={dist} />
          </Panel>

          <Panel
            title="Plant total active power (incomer)"
            span="col-span-12 lg:col-span-8"
          >
            <TimeSeries
              id="plant-kw"
              tableHref={`/chart/plant-power${winQs ? `?${winQs}` : ""}`}
              series={plantSeries}
              unit="kW"
              decimals={0}
              height={240}
              statLabel={bucketLabel(win)}
            />
          </Panel>

          <Panel title="Active power by meter — incomer and sub-meters" span="col-span-12">
            <TimeSeries
              id="meter-kw"
              tableHref={`/chart/power${winQs ? `?${winQs}` : ""}`}
              series={byMeter}
              unit="kW"
              decimals={0}
              height={220}
              statLabel={bucketLabel(win)}
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
