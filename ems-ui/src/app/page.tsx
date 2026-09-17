import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import TimeSeries from "@/components/TimeSeries";
import Distribution from "@/components/Distribution";
import IncomerBreakdown from "@/components/IncomerBreakdown";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import EmptyPlant from "@/components/EmptyPlant";
import { apparentEnergy, energy, fmt, power } from "@/lib/format";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  bucketLabel,
  distributionFor,
  incomerBreakdown,
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
    const { plant, config } = await getSelectedPlant();
    const topo = await getTopology(plant);

    if (topo.allIds.length === 0) {
      return (
        <>
          <Filters title="Plant Rollup" range={rangeForUi} warnings={warnings} />
          <EmptyPlant plantName={config?.name} />
        </>
      );
    }

    const rootIds = topo.rootIds;
    const allIds = topo.allIds;
    // This plant may have several independent utility incomers (each a root), or
    // a single incomer with sub-meters beneath it. The rollup handles both.
    const multiIncomer = rootIds.length > 1;
    const mainId = rootIds[0];
    const childIds = topo.childrenOf(mainId).map((n) => n.id);
    // Single visible root with no visible sub-meters (e.g. others hidden until
    // their hierarchy position is confirmed): nothing to break the energy down against.
    const soloMeter = !multiIncomer && childIds.length === 0;

    const [kw, energyToday, pf, meters, plantSeries, byMeter, breakdown, dist] =
      await Promise.all([
        plantActivePowerKw(plant, rootIds),
        plantEnergyKvah(plant, rootIds, win),
        plantPowerFactor(plant, rootIds),
        metersOnline(plant, allIds),
        plantPowerSeries(plant, rootIds, win),
        powerByMeter(plant, allIds, win),
        incomerBreakdown(plant, rootIds, win),
        distributionFor(plant, mainId, childIds, win),
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
          {multiIncomer ? (
            <span>
              <strong className="font-medium text-foreground">
                Plant totals sum the {rootIds.length} incomers ({rootIds.join(", ")}).
              </strong>{" "}
              These are independent utility incomers — their feeds don&apos;t overlap, so
              the plant total is their sum, not a double-count. Any sub-meters sit
              downstream of an incomer and are already inside its reading.
            </span>
          ) : soloMeter ? (
            <span>
              <strong className="font-medium text-foreground">
                Totals are <code className="normal-case">{mainId}</code>&apos;s reading.
              </strong>{" "}
              It is the only meter shown for this plant, so the figures are exactly what
              it measures. Any other meters are hidden until their place in the hierarchy
              is confirmed — add or unhide them to see a breakdown.
            </span>
          ) : (
            <span>
              <strong className="font-medium text-foreground">
                Totals are the incomer&apos;s, not the sum of all meters.
              </strong>{" "}
              <code className="normal-case">{mainId}</code> is the utility incomer and{" "}
              {childIds.join(", ")} sit downstream of it, so their consumption is already
              inside its reading. Summing all of them would double-count.
            </span>
          )}
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
            sub={
              multiIncomer
                ? `Sum of ${rootIds.length} incomers, latest 30s reading`
                : `Incomer ${mainId}, latest 30s reading`
            }
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
            title={
              multiIncomer
                ? "Where the energy comes in — by incomer"
                : soloMeter
                  ? `${mainId} — no sub-meters configured`
                  : `Where the energy goes — ${mainId} against its sub-meters`
            }
            span="col-span-12 lg:col-span-4"
          >
            {multiIncomer ? (
              <IncomerBreakdown data={breakdown} />
            ) : soloMeter ? (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Only <code className="normal-case">{mainId}</code> is shown, so there is
                nothing to break its {energy(energyToday.kwh).value}{" "}
                {energy(energyToday.kwh).unit} down against. Unhide or add the sub-meters
                that sit under it — once their positions are confirmed — to see how the
                energy distributes.
              </p>
            ) : (
              <Distribution dist={dist} />
            )}
          </Panel>

          <Panel
            title={multiIncomer ? "Plant total active power (all incomers)" : "Plant total active power (incomer)"}
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

          <Panel
            title={multiIncomer ? "Active power by meter" : "Active power by meter — incomer and sub-meters"}
            span="col-span-12"
          >
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
