import { notFound } from "next/navigation";
import Filters from "@/components/Filters";
import ServerDataTable from "@/components/ServerDataTable";
import MeterSelect from "@/components/MeterSelect";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { fmt, istDateTime } from "@/lib/format";
import { getTopology, type Topology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import {
  isSortKey,
  rangeTouchesCorruptWindow,
  RAW_COLUMNS,
  rawNumber,
  telemetryRows,
  windowFromParams,
  windowParams,
} from "@/lib/queries";
import { numCell, textCell, timeCell, type DataColumn, type DataRow } from "@/lib/datatable";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [25, 50, 100, 200];

export default async function DataTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ meter: string }>;
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const { meter } = await params;
  const sp = await searchParams;
  const { win, warnings } = windowFromParams(sp);
  const winQs = windowParams(sp);
  const rangeForUi = typeof win === "string" ? win : "24h";

  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const wanted = Number.parseInt(sp.pageSize ?? "50", 10);
  const pageSize = PAGE_SIZES.includes(wanted) ? wanted : 50;
  const sort = isSortKey(sp.sort) ? (sp.sort as string) : "timestamp";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";

  const { plant } = await getSelectedPlant();
  let topo: Topology;
  try {
    topo = await getTopology(plant);
  } catch (err) {
    return <DbError error={err} />;
  }
  if (!topo.allIds.includes(meter)) notFound();

  try {
    const { rows: raw, total } = await telemetryRows(plant, meter, win, { page, pageSize, sort, dir });

    const columns: DataColumn[] = RAW_COLUMNS.map((c) => ({
      key: c.key,
      label: c.unit ? `${c.label} (${c.unit})` : c.label,
      align: c.kind === "num" ? ("right" as const) : ("left" as const),
      preserveCase: c.kind === "text",
    }));

    const rows: DataRow[] = raw.map((row) => {
      const out: DataRow = {};
      for (const c of RAW_COLUMNS) {
        const v = row[c.col];
        if (c.kind === "time") {
          out[c.key] = timeCell(istDateTime(v as string), new Date(v as string).toISOString());
        } else if (c.kind === "text") {
          out[c.key] = textCell(v == null ? "—" : String(v));
        } else {
          const n = rawNumber(c, v);
          out[c.key] = numCell(n, fmt(n, c.decimals ?? 1));
        }
      }
      return out;
    });

    const exportHref = `/data/${meter}/export?${[winQs, `sort=${sort}`, `dir=${dir}`]
      .filter(Boolean)
      .join("&")}`;

    return (
      <>
        <Filters title={`Data — ${meter}`} range={rangeForUi} warnings={warnings} refreshSeconds={30} />

        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground">Meter</span>
          <MeterSelect meters={topo.allIds} value={meter} basePath="/data" query={winQs} />
          {topo.isRoot(meter) && (
            <span className="text-[10px] text-muted-foreground normal-case">incomer / root</span>
          )}
        </div>

        {rangeTouchesCorruptWindow(win) && (
          <Notice>
            <span>
              <strong className="font-medium text-foreground">
                This window includes corrupted energy data
              </strong>{" "}
              (14–18 Aug). The <code className="normal-case">Energy (kWh)</code> column is a
              cumulative counter that returns garbage over this window; voltage, current, power,
              PF and THD are unaffected.
            </span>
          </Notice>
        )}

        <div className="grid grid-cols-12 gap-3 pb-4">
          <Panel title={`Raw readings — ${fmt(total, 0)} rows`} span="col-span-12">
            <ServerDataTable
              columns={columns}
              rows={rows}
              rowCount={total}
              page={page}
              pageSize={pageSize}
              sort={sort}
              dir={dir}
              exportHref={exportHref}
            />
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
