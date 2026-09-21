import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import TimeSeries from "@/components/TimeSeries";
import DemandBars from "@/components/DemandBars";
import DataTable from "@/components/DataTable";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import EmptyPlant from "@/components/EmptyPlant";
import { fmt, rupees } from "@/lib/format";
import { numCell, textCell, type DataColumn, type DataRow } from "@/lib/datatable";
import { getTopology, PLANT_DEFAULTS } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  bucketLabel,
  coincidentMaxDemand,
  costByMeter,
  pfByMeter,
  pfStats,
  plantEnergyKvah,
  rangeTouchesCorruptWindow,
  winLabel,
  windowFromParams,
  windowParams,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CostDemand({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { win, warnings } = windowFromParams(sp);
  const winQs = windowParams(sp);
  const rangeForUi = typeof win === "string" ? win : "24h";
  const spanLabel = winLabel(win);

  try {
    const { plant, config } = await getSelectedPlant();
    // Commercial config is per-plant, straight from the plant registry row.
    const TARIFF = config?.tariffKvah ?? PLANT_DEFAULTS.tariffKvah;
    // null = sanctioned demand not confirmed for this plant → no false %-of-contract.
    const CONTRACT = config?.contractKva ?? null;
    const BLOCK_MIN = config?.demandBlockMin ?? PLANT_DEFAULTS.demandBlockMin;
    const topo = await getTopology(plant);

    if (topo.allIds.length === 0) {
      return (
        <>
          <Filters title="Cost & Demand" range={rangeForUi} warnings={warnings} />
          <EmptyPlant plantName={config?.name} />
        </>
      );
    }

    const rootIds = topo.rootIds;
    const allIds = topo.allIds;
    // Several independent incomers (each a root), or one incomer with sub-meters.
    const multiIncomer = rootIds.length > 1;
    const mainId = rootIds[0];
    const childIds = topo.childrenOf(mainId).map((n) => n.id);
    // Single visible meter, no visible sub-meters: nothing to allocate the bill across.
    const soloMeter = !multiIncomer && childIds.length === 0;

    const [costs, plantEnergy, demand, pf, pfs] = await Promise.all([
      costByMeter(plant, allIds, win, TARIFF),
      plantEnergyKvah(plant, rootIds, win),
      coincidentMaxDemand(plant, rootIds, win, BLOCK_MIN),
      pfByMeter(plant, allIds, win),
      pfStats(plant, allIds, win),
    ]);

    // The utility bill is the WHOLE plant: the sum of every incomer (root), on
    // the same load-weighted kVAh basis as the rollup — never one root alone.
    const plantKwh = plantEnergy.kwh;
    const plantKvah = plantEnergy.kvah;
    const plantCost = plantKvah === null ? null : plantKvah * TARIFF;

    // Rows apportion that single bill by energy share, for internal chargeback.
    // Multi-incomer: split across the incomers. Single incomer: split across its
    // sub-meters (plantKwh is then that incomer's own energy, so the maths agree).
    const allocTargets = multiIncomer ? rootIds : childIds;
    const allocation = allocTargets.map((id) => {
      const c = costs.find((x) => x.deviceId === id);
      const kwh = c?.kwh ?? null;
      const share = plantKwh && plantKwh > 0 && kwh != null ? kwh / plantKwh : null;
      return {
        deviceId: id,
        kwh,
        pf: c?.pf ?? null,
        share,
        cost: share !== null && plantCost !== null ? plantCost * share : null,
      };
    });
    const allocatedShare = allocation.reduce((a, r) => a + (r.share ?? 0), 0);
    const unattributedShare = 1 - allocatedShare;
    const unattributedKwh =
      plantKwh === null ? null : plantKwh - allocation.reduce((a, r) => a + (r.kwh ?? 0), 0);

    const pfColumns: DataColumn[] = [
      { key: "meter", label: "Meter", align: "left" },
      { key: "min", label: "Min", align: "right" },
      { key: "avg", label: "Average", align: "right" },
      { key: "below", label: "Time below 0.90", align: "right" },
    ];
    const pfRows: DataRow[] = pfs.map((s) => ({
      meter: textCell(s.deviceId),
      min: numCell(s.min, fmt(s.min, 3)),
      avg: numCell(s.avg, fmt(s.avg, 3)),
      below: numCell(
        s.pctBelow,
        `${fmt(s.pctBelow, 0)}%`,
        (s.pctBelow ?? 0) > 50 ? "text-bad" : undefined,
      ),
    }));

    const allocColumns: DataColumn[] = [
      { key: "meter", label: "Meter", align: "left" },
      { key: "kwh", label: "kWh", align: "right" },
      { key: "share", label: "Share", align: "right" },
      { key: "cost", label: "Allocated", align: "right" },
    ];
    const allocRows: DataRow[] = allocation.map((r) => ({
      meter: textCell(r.deviceId),
      kwh: numCell(r.kwh, fmt(r.kwh, 0)),
      share: numCell(r.share, r.share === null ? "—" : `${fmt(r.share * 100, 1)}%`),
      cost: numCell(r.cost, rupees(r.cost)),
    }));

    return (
      <>
        <Filters title="Cost & Demand" range={rangeForUi} warnings={warnings} />

        <Notice>
          {multiIncomer ? (
            <span>
              <strong className="font-medium text-foreground">
                One bill across all {rootIds.length} incomers, then allocated.
              </strong>{" "}
              The cost above is the combined energy of every incomer (
              {rootIds.join(", ")}). Rows below apportion that same spend by each
              incomer&apos;s energy share for internal chargeback — they are not
              additional bills.
            </span>
          ) : soloMeter ? (
            <span>
              <strong className="font-medium text-foreground">
                Cost is <code className="normal-case">{mainId}</code>&apos;s energy.
              </strong>{" "}
              It is the only meter shown for this plant, so the bill above is exactly its
              consumption. There are no sub-meters to allocate it across yet — unhide or
              add them once their hierarchy position is confirmed.
            </span>
          ) : (
            <span>
              <strong className="font-medium text-foreground">
                One bill, allocated — not many bills added up.
              </strong>{" "}
              The utility meters <code className="normal-case">{mainId}</code>, so that is
              the cost. Sub-meter rows below are that same cost apportioned by energy
              share for internal chargeback; they are not additional spend.
            </span>
          )}
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

        {rangeTouchesCorruptWindow(win) && (
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
            label={`Utility-billed cost — ${spanLabel}`}
            value={rupees(plantCost)}
            span="col-span-12 lg:col-span-4"
            sub={`${fmt(plantKvah, 0)} kVAh at ₹${TARIFF}/kVAh · ${fmt(plantKwh, 0)} kWh ${
              multiIncomer ? `across ${rootIds.length} incomers` : "at the incomer"
            }`}
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
              tableHref={`/chart/pf${winQs ? `?${winQs}` : ""}`}
              series={pf}
              unit=""
              decimals={3}
              height={230}
              statLabel={bucketLabel(win)}
              showBand={false}
              threshold={{ value: 0.9, label: "0.90 REFERENCE", tone: "warn" }}
            />
            <div className="mt-3">
              <DataTable columns={pfColumns} rows={pfRows} filterable={false} initialPageSize={10} exportName="ems_power_factor" />
            </div>
          </Panel>

          <Panel
            title={soloMeter ? `Billed cost — ${spanLabel}` : `Cost allocation — ${spanLabel}`}
            span="col-span-12 lg:col-span-5"
          >
            {soloMeter ? (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                <code className="normal-case">{mainId}</code> is the only meter shown, so
                the whole bill — <span className="tnum">{rupees(plantCost)}</span> for{" "}
                <span className="tnum">{fmt(plantKwh, 0)}</span> kWh — is its own. There
                are no sub-meters to apportion it across. Unhide or add the sub-meters
                under it, once their positions are confirmed, to see chargeback here.
              </p>
            ) : (
              <>
                <DataTable columns={allocColumns} rows={allocRows} filterable={false} initialPageSize={10} exportName="ems_cost_allocation" />
                {/* Totals are a fixed footer, not sortable data. */}
                <table className="table table-bordered mt-2 text-[11px] tnum">
                  <tbody>
                    <tr>
                      <td className="text-left text-muted-foreground">Unattributed</td>
                      <td className="text-right">{fmt(unattributedKwh, 0)}</td>
                      <td className="text-right">{fmt(unattributedShare * 100, 1)}%</td>
                      <td className="text-right">
                        {rupees(plantCost === null ? null : plantCost * unattributedShare)}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-left font-medium">
                        {multiIncomer ? "Plant total (billed)" : `${mainId} (billed)`}
                      </td>
                      <td className="text-right font-medium">{fmt(plantKwh, 0)}</td>
                      <td className="text-right font-medium">100%</td>
                      <td className="text-right font-medium">{rupees(plantCost)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
