import Filters from "@/components/Filters";
import StatTile from "@/components/StatTile";
import Distribution from "@/components/Distribution";
import TopologyEditor from "@/components/TopologyEditor";
import DataTable from "@/components/DataTable";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { fmt } from "@/lib/format";
import { numCell, textCell, type DataColumn, type DataRow } from "@/lib/datatable";
import { getManagedDevices, getTopology, type MeterNode } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  deviceSnapshots,
  distributionFor,
  meterList,
  windowFromParams,
  type DeviceSnapshot,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const ago = (s: number | null) => {
  if (s === null) return "never";
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** Live for under two minutes, stale up to an hour, then treat it as down. */
function health(s: DeviceSnapshot | undefined) {
  const age = s?.ageSeconds ?? null;
  if (age === null) return { tone: "var(--bad)", label: "No data" };
  if (age < 120) return { tone: "var(--good)", label: "Live" };
  if (age < 3600) return { tone: "var(--warn)", label: "Stale" };
  return { tone: "var(--bad)", label: "Down" };
}

function DeviceRow({
  node,
  snap,
  childCount,
}: {
  node: MeterNode;
  snap: DeviceSnapshot | undefined;
  childCount: number;
}) {
  const h = health(snap);
  return (
    <div
      className="grid grid-cols-[minmax(160px,1.4fr)_repeat(4,minmax(70px,1fr))_minmax(110px,1.1fr)] items-center gap-3 border-b border-border py-2 last:border-b-0"
      style={{ paddingLeft: node.depth * 18 }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {node.depth > 0 && (
          <span aria-hidden className="select-none text-muted-foreground">
            └
          </span>
        )}
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: h.tone }}
          title={h.label}
        />
        <span className="truncate font-medium">{node.id}</span>
        {node.parentId === null ? (
          <span className="shrink-0 rounded-sm bg-brand px-1.5 py-0.5 text-[9px] text-white">
            Incomer
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            under {node.parentId}
          </span>
        )}
        {node.area && (
          <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground normal-case">
            {node.area}
          </span>
        )}
      </div>

      <span className="tnum text-right">{fmt(snap?.kw ?? null, 1)} kW</span>
      <span className="tnum text-right">{fmt(snap?.pf ?? null, 3)}</span>
      <span className="tnum text-right">{fmt(snap?.kwhToday ?? null, 0)} kWh</span>
      <span className="tnum text-right text-muted-foreground">
        {node.slave === null ? "—" : `slave ${node.slave}`}
      </span>
      <span className="text-right text-[10px] text-muted-foreground">
        {node.registers.length} regs · {childCount} sub · {ago(snap?.ageSeconds ?? null)}
      </span>
    </div>
  );
}

export default async function Topology({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { win, warnings } = windowFromParams(sp);
  const rangeForUi = typeof win === "string" ? win : "24h";

  try {
    const { plant } = await getSelectedPlant();
    const topo = await getTopology(plant);
    const configured = topo.allIds;

    const [snaps, reporting] = await Promise.all([
      deviceSnapshots(configured),
      meterList(plant),
    ]);
    const snapBy = new Map(snaps.map((s) => [s.deviceId, s]));

    // Drift between the register map and what is actually in the database.
    const configuredSet = new Set(configured);
    const orphaned = reporting.filter((id) => !configuredSet.has(id));
    const silent = snaps.filter((s) => s.ageSeconds === null).map((s) => s.deviceId);

    // Depth-first so children render directly beneath their parent.
    const ordered: MeterNode[] = [];
    const walk = (n: MeterNode) => {
      ordered.push(n);
      for (const c of topo.childrenOf(n.id)) walk(c);
    };
    for (const r of topo.roots) walk(r);

    const parents = ordered.filter((n) => topo.childrenOf(n.id).length > 0);
    const dists = await Promise.all(
      parents.map((n) =>
        distributionFor(
          n.id,
          topo.childrenOf(n.id).map((c) => c.id),
          win,
        ),
      ),
    );

    const maxDepth = Math.max(...ordered.map((n) => n.depth));
    const live = snaps.filter((s) => (s.ageSeconds ?? Infinity) < 120).length;

    // Editor data: every managed device (incl. hidden) + adoptable orphans.
    const managed = await getManagedDevices(plant);
    const managedIds = new Set(managed.map((m) => m.id));
    const adoptable = reporting.filter((id) => !managedIds.has(id));

    const regColumns: DataColumn[] = [
      { key: "device", label: "Device", align: "left" },
      { key: "area", label: "Area", align: "left", preserveCase: true },
      { key: "slave", label: "Slave", align: "right" },
      { key: "registers", label: "Registers (name @ address, ×scale)", align: "left", preserveCase: true },
    ];
    const regRows: DataRow[] = ordered.map((n) => ({
      device: textCell(n.id),
      area: textCell(n.area ?? "—"),
      slave: numCell(n.slave, n.slave === null ? "—" : String(n.slave)),
      registers: textCell(
        n.registers.map((r) => `${r.name}@${r.address}${r.scale ? `×${r.scale}` : ""}`).join("  "),
      ),
    }));

    return (
      <>
        <Filters title="Device Tree" range={rangeForUi} warnings={warnings} />

        <Notice>
          <span>
            <strong className="font-medium text-foreground">
              Bound directly to the register map.
            </strong>{" "}
            Every row below is a device declared in{" "}
            <code className="normal-case">config/devices.yaml</code> — the same file the
            poller reads — so the hierarchy shown here is the hierarchy the platform
            actually uses. A meter with no parent is an incomer, and its reading already
            contains everything nested under it.
          </span>
        </Notice>

        {orphaned.length > 0 && (
          <Notice kind="error">
            <span>
              <strong className="font-medium text-foreground">
                Reporting but not declared:
              </strong>{" "}
              <code className="normal-case">{orphaned.join(", ")}</code>. These are
              writing telemetry but are absent from the register map, so they belong to
              no plant total and no allocation. Either add them with a{" "}
              <code className="normal-case">parent</code>, or find out what is writing
              them.
            </span>
          </Notice>
        )}

        {silent.length > 0 && (
          <Notice>
            <span>
              <strong className="font-medium text-foreground">
                Declared but silent:
              </strong>{" "}
              <code className="normal-case">{silent.join(", ")}</code> — configured in
              the register map but no telemetry in the last 7 days.
            </span>
          </Notice>
        )}

        <div className="grid grid-cols-12 gap-3 pb-4">
          <StatTile
            label="Devices declared"
            value={String(configured.length)}
            sub="In the register map"
          />
          <StatTile
            label="Reporting now"
            value={String(live)}
            unit={`of ${configured.length}`}
            tone={live === configured.length ? "good" : "crit"}
            status={live === configured.length ? "All live" : "Gap"}
            sub="Seen in the last 2 minutes"
          />
          <StatTile
            label="Incomers"
            value={String(topo.roots.length)}
            sub={`Root meters: ${topo.rootIds.join(", ")}`}
          />
          <StatTile
            label="Hierarchy depth"
            value={String(maxDepth + 1)}
            unit="levels"
            sub="Incomer counts as level 1"
          />

          <Panel title="Device hierarchy" span="col-span-12">
            <div className="grid grid-cols-[minmax(160px,1.4fr)_repeat(4,minmax(70px,1fr))_minmax(110px,1.1fr)] gap-3 border-b border-border pb-1.5 text-[10px] text-muted-foreground">
              <span>Device</span>
              <span className="text-right">Power</span>
              <span className="text-right">PF</span>
              <span className="text-right">Today</span>
              <span className="text-right">Modbus</span>
              <span className="text-right">Config · last seen</span>
            </div>
            <div className="text-[11.5px]">
              {ordered.map((n) => (
                <DeviceRow
                  key={n.id}
                  node={n}
                  snap={snapBy.get(n.id)}
                  childCount={topo.childrenOf(n.id).length}
                />
              ))}
            </div>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              &quot;Today&quot; is each device&apos;s own consumption since 00:00 IST.
              These do not add up to the plant total — a sub-meter&apos;s energy is
              already counted inside its parent.
            </p>
          </Panel>

          {parents.map((n, i) => (
            <Panel
              key={n.id}
              title={`Energy balance — ${n.id} against its sub-meters`}
              span="col-span-12 lg:col-span-6"
            >
              <Distribution dist={dists[i]} />
            </Panel>
          ))}

          <Panel
            title="Edit hierarchy"
            note="Writes the DB device registry — parent, area, label, hide, and new meters"
            span="col-span-12"
          >
            <TopologyEditor plant={plant} devices={managed} orphans={adoptable} />
          </Panel>

          <Panel title="Register map by device" span="col-span-12">
            <DataTable columns={regColumns} rows={regRows} initialPageSize={25} exportName="ems_register_map" />
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
