import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import TimeSeries from "@/components/TimeSeries";
import DemandBars from "@/components/DemandBars";
import DataTable from "@/components/DataTable";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
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
  rangeTouchesCorruptWindow,
  reactiveEnergyByMeter,
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
    const CONTRACT = config?.contractKva ?? PLANT_DEFAULTS.contractKva;
    const BLOCK_MIN = config?.demandBlockMin ?? PLANT_DEFAULTS.demandBlockMin;
    const topo = await getTopology(plant);
    const rootIds = topo.rootIds;
    const allIds = topo.allIds;
    const mainId = rootIds[0];
    const childIds = topo.childrenOf(mainId).map((n) => n.id);

    const [costs, demand, pf, pfs, reactive] = await Promise.all([
      costByMeter(allIds, win, TARIFF),
      coincidentMaxDemand(rootIds, win, BLOCK_MIN),
      pfByMeter(allIds, win),
      pfStats(allIds, win),
      reactiveEnergyByMeter(allIds, win),
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
    const unattributedKwh =
      rootKwh === null ? null : rootKwh - allocation.reduce((a, r) => a + (r.kwh ?? 0), 0);

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
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              0.90 is an engineering reference, not a billing threshold — under kVAh
              billing a poor power factor is already priced as inflated kVAh rather
              than a separate penalty line. Minimum and time-below matter here;
              a maximum does not.
            </p>
          </Panel>

          <Panel
            title={`Cost allocation — ${spanLabel}`}
            span="col-span-12 lg:col-span-5"
          >
            <DataTable columns={allocColumns} rows={allocRows} filterable={false} initialPageSize={10} exportName="ems_cost_allocation" />
            {/* Totals are a fixed footer, not sortable data. */}
            <table className="table table-bordered mt-2 text-[11px] tnum">
              <tbody>
                <tr>
                  <td className="text-left text-muted-foreground">Unattributed</td>
                  <td className="text-right">{fmt(unattributedKwh, 0)}</td>
                  <td className="text-right">{fmt(unattributedShare * 100, 1)}%</td>
                  <td className="text-right">
                    {rupees(rootCost === null ? null : rootCost * unattributedShare)}
                  </td>
                </tr>
                <tr>
                  <td className="text-left font-medium">{mainId} (billed)</td>
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
              tableHref={`/chart/reactive-energy${winQs ? `?${winQs}` : ""}`}
              series={reactive}
              unit="kVArh"
              decimals={0}
              height={180}
              statLabel={bucketLabel(win)}
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
