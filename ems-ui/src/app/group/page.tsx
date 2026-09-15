import StatTile from "@/components/StatTile";
import DataTable from "@/components/DataTable";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { fmt } from "@/lib/format";
import { numCell, textCell, type DataColumn, type DataRow } from "@/lib/datatable";
import { getTopology, listPlants, type PlantInfo } from "@/lib/topology";
import {
  coincidentMaxDemand,
  metersOnline,
  plantActivePowerKw,
  plantEnergyKvah,
  plantPowerFactor,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type PlantRollup = {
  plant: PlantInfo;
  devices: number;
  online: number;
  kw: number | null;
  kwhToday: number | null;
  kvahToday: number | null;
  pf: number | null;
  peakKva: number | null;
};

/** One live/today rollup per plant, computed against that plant's own roots. */
async function rollupFor(plant: PlantInfo): Promise<PlantRollup> {
  const topo = await getTopology(plant.id);
  const [kw, energy, pf, online, demand] = await Promise.all([
    plantActivePowerKw(plant.id, topo.rootIds),
    plantEnergyKvah(plant.id, topo.rootIds, "today"),
    plantPowerFactor(plant.id, topo.allIds),
    metersOnline(plant.id, topo.allIds),
    coincidentMaxDemand(plant.id, topo.rootIds, "today", plant.demandBlockMin),
  ]);
  return {
    plant,
    devices: online.total,
    online: online.online,
    kw,
    kwhToday: energy.kwh,
    kvahToday: energy.kvah,
    pf,
    peakKva: demand.coincidentKva,
  };
}

export default async function GroupDashboard() {
  let plants: PlantInfo[];
  try {
    plants = await listPlants();
  } catch (err) {
    return <DbError error={err} />;
  }

  if (plants.length === 0) {
    return (
      <>
        <Header tenant="" />
        <Notice kind="error">
          <span>No plants are registered yet. Add a plant to the registry to see it here.</span>
        </Notice>
      </>
    );
  }

  try {
    const rollups = await Promise.all(plants.map(rollupFor));

    const totalKw = sum(rollups.map((r) => r.kw));
    const totalKwh = sum(rollups.map((r) => r.kwhToday));
    const totalKvah = sum(rollups.map((r) => r.kvahToday));
    const totalOnline = rollups.reduce((a, r) => a + r.online, 0);
    const totalDevices = rollups.reduce((a, r) => a + r.devices, 0);
    const allOnline = totalDevices > 0 && totalOnline === totalDevices;

    const columns: DataColumn[] = [
      { key: "plant", label: "Plant", align: "left", preserveCase: true },
      { key: "kw", label: "Live load", align: "right" },
      { key: "kwh", label: "Energy today", align: "right" },
      { key: "kvah", label: "kVAh today", align: "right" },
      { key: "pf", label: "PF (15-min)", align: "right" },
      { key: "meters", label: "Meters online", align: "right" },
      { key: "demand", label: "Peak demand vs contract", align: "right", preserveCase: true },
    ];
    const rows: DataRow[] = rollups.map((r) => {
      const pct = r.peakKva !== null && r.plant.contractKva > 0
        ? (r.peakKva / r.plant.contractKva) * 100
        : null;
      const demandText =
        r.peakKva === null
          ? "—"
          : `${fmt(r.peakKva, 0)} / ${fmt(r.plant.contractKva, 0)} kVA${pct === null ? "" : ` (${fmt(pct, 0)}%)`}`;
      return {
        plant: textCell(r.plant.name),
        kw: numCell(r.kw, `${fmt(r.kw, 1)} kW`),
        kwh: numCell(r.kwhToday, `${fmt(r.kwhToday, 0)} kWh`),
        kvah: numCell(r.kvahToday, `${fmt(r.kvahToday, 0)} kVAh`),
        pf: numCell(r.pf, fmt(r.pf, 3), (r.pf ?? 1) < 0.9 ? "text-bad" : undefined),
        meters: numCell(r.online, `${r.online} / ${r.devices}`, r.online < r.devices ? "text-bad" : undefined),
        demand: numCell(pct, demandText, (pct ?? 0) > 100 ? "text-bad" : undefined),
      };
    });

    return (
      <>
        <Header tenant={plants[0].tenantName} />

        <Notice>
          <span>
            <strong className="font-medium text-foreground">
              Group view across all registered plants.
            </strong>{" "}
            Each row is one plant, rolled up from its own incomer(s) — energy and demand are
            today (since 00:00 IST); load and power factor are live. Totals sum the plants; they
            are not double-counted, because each plant&apos;s incomer already contains its
            sub-meters. Switch the active plant from the selector in the sidebar.
          </span>
        </Notice>

        <div className="grid grid-cols-12 gap-3 pb-4">
          <StatTile label="Plants" value={String(plants.length)} span="col-span-6 lg:col-span-3" sub="Registered" />
          <StatTile
            label="Live load — group"
            value={fmt(totalKw, 1)}
            unit="kW"
            span="col-span-6 lg:col-span-3"
            sub="Sum of all incomers, now"
          />
          <StatTile
            label="Energy today — group"
            value={fmt(totalKwh, 0)}
            unit="kWh"
            span="col-span-6 lg:col-span-3"
            sub={`${fmt(totalKvah, 0)} kVAh apparent`}
          />
          <StatTile
            label="Meters online"
            value={String(totalOnline)}
            unit={`of ${totalDevices}`}
            tone={allOnline ? "good" : "crit"}
            status={allOnline ? "All live" : "Gap"}
            span="col-span-6 lg:col-span-3"
            sub="Seen in the last minute"
          />

          <Panel title="Plants — live load and today" span="col-span-12">
            <DataTable
              columns={columns}
              rows={rows}
              filterable={false}
              initialPageSize={25}
              exportName="ems_all_plants"
            />
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}

function Header({ tenant }: { tenant: string }) {
  return (
    <div className="flex items-baseline justify-between py-4">
      <h1 className="text-lg font-semibold">All Plants</h1>
      {tenant && (
        <span className="text-[11px] text-muted-foreground">{tenant} · live now / today (IST)</span>
      )}
    </div>
  );
}

function sum(xs: (number | null)[]): number | null {
  const vals = xs.filter((x): x is number => x !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}
