import { notFound } from "next/navigation";
import Filters from "@/components/Filters";
import TimeSeries from "@/components/TimeSeries";
import DataTable from "@/components/DataTable";
import { Panel } from "@/components/Panel";
import DbError from "@/components/DbError";
import { fmt, istDateTime } from "@/lib/format";
import { getTopology, type Topology } from "@/lib/topology";
import { bucketLabel, winLabel, windowFromParams } from "@/lib/queries";
import { chartBySlug, pivotSeries } from "@/lib/charts";
import { numCell, timeCell, type DataColumn, type DataRow } from "@/lib/datatable";

export const dynamic = "force-dynamic";

export default async function ChartTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ metric: string }>;
  searchParams: Promise<{ range?: string; meter?: string; from?: string; to?: string }>;
}) {
  const { metric } = await params;
  const sp = await searchParams;

  const def = chartBySlug(metric);
  if (!def) notFound();

  const { win, warnings } = windowFromParams(sp);
  const rangeForUi = typeof win === "string" ? win : "24h";
  const spanLabel = winLabel(win);

  let topo: Topology;
  try {
    topo = await getTopology();
  } catch (err) {
    return <DbError error={err} />;
  }
  const meter = sp.meter && topo.allIds.includes(sp.meter) ? sp.meter : topo.allIds[0] ?? "";

  try {
    const series = await def.load(win, { allIds: topo.allIds, rootIds: topo.rootIds, meter });
    const { columns: seriesNames, rows: pivot } = pivotSeries(series, "time", "desc");

    const columns: DataColumn[] = [
      { key: "time", label: "Time (IST)", align: "left" },
      ...seriesNames.map((name) => ({
        key: name,
        label: def.unit ? `${name} (${def.unit})` : name,
        align: "right" as const,
      })),
    ];
    const rows: DataRow[] = pivot.map((r) => {
      const row: DataRow = { time: timeCell(istDateTime(r.t), r.t) };
      for (const name of seriesNames) {
        const v = r.vals[name] ?? null;
        row[name] = numCell(v, fmt(v, def.decimals));
      }
      return row;
    });

    const title = def.needsMeter ? `${def.title} — ${meter}` : def.title;

    return (
      <>
        <Filters
          title={title}
          range={rangeForUi}
          meters={def.needsMeter ? topo.allIds : undefined}
          meter={def.needsMeter ? meter : undefined}
          warnings={warnings}
          refreshSeconds={30}
        />

        <div className="grid grid-cols-12 gap-3 pb-4">
          <Panel title={`${def.title} — chart`} span="col-span-12">
            <TimeSeries
              id={`chart-${metric}`}
              series={series}
              unit={def.unit}
              decimals={def.decimals}
              height={260}
              statLabel={bucketLabel(win)}
              showBand={false}
              hideExpand
            />
          </Panel>

          <Panel title={`${def.title} — ${spanLabel}`} span="col-span-12">
            <DataTable
              columns={columns}
              rows={rows}
              initialSortKey="time"
              initialDir="desc"
              exportName={
                def.needsMeter ? `ems_${metric}_${meter}_${rangeForUi}` : `ems_${metric}_${rangeForUi}`
              }
            />
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
