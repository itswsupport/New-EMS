import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import TimeSeries from "@/components/TimeSeries";
import Distribution from "@/components/Distribution";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { energy, fmt, power } from "@/lib/format";
import { getTopology } from "@/lib/topology";
import {
  bucketLabel,
  distributionFor,
  isRange,
  metersOnline,
  plantActivePowerKw,
  plantEnergyTodayKwh,
  plantPowerFactor,
  plantPowerSeries,
  powerByMeter,
  rangeTouchesCorruptWindow,
  type RangeKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlantRollup({
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

    const [kw, kwh, pf, meters, plantSeries, byMeter, dist] = await Promise.all([
      plantActivePowerKw(rootIds),
      plantEnergyTodayKwh(rootIds),
      plantPowerFactor(rootIds),
      metersOnline(allIds),
      plantPowerSeries(rootIds, range),
      powerByMeter(allIds, range),
      distributionFor(mainId, childIds, range),
    ]);

    const p = power(kw);
    const e = energy(kwh);
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
        <Filters title="Plant Rollup" range={range} warnings={warnings} />

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

        {rangeTouchesCorruptWindow(range) && (
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
            label="Plant energy today"
            value={e.value}
            unit={e.unit}
            sub="Since 00:00 IST — not the UTC day"
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
              series={plantSeries}
              unit="kW"
              decimals={0}
              height={240}
              statLabel={bucketLabel(range)}
            />
          </Panel>

          <Panel title="Active power by meter — incomer and sub-meters" span="col-span-12">
            <TimeSeries
              id="meter-kw"
              series={byMeter}
              unit="kW"
              decimals={0}
              height={220}
              statLabel={bucketLabel(range)}
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
