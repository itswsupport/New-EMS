import { notFound } from "next/navigation";
import Filters from "@/components/Filters";
import { Panel, Notice } from "@/components/Panel";
import DbError from "@/components/DbError";
import { fmt, istDateTime } from "@/lib/format";
import { getTopology, type Topology } from "@/lib/topology";
import {
  isRange,
  RANGES,
  rangeTouchesCorruptWindow,
  RAW_COLUMNS,
  rawNumber,
  telemetryRows,
  type RangeKey,
  type RawColumn,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Segmented-control button, matching Filters' range/meter pills. */
function seg(active: boolean): string {
  return `px-2.5 py-1.5 text-[11px] border-r border-border last:border-r-0 transition-colors ${
    active
      ? "bg-brand text-white"
      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
  }`;
}

/** A query string that drops empty/undefined values. */
function qs(patch: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function cellText(col: RawColumn, v: unknown): string {
  if (col.kind === "time") return istDateTime(v as string);
  if (col.kind === "text") return v == null ? "—" : String(v);
  return fmt(rawNumber(col, v), col.decimals ?? 1);
}

export default async function DataTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ meter: string }>;
  searchParams: Promise<{ range?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const { meter } = await params;
  const sp = await searchParams;

  const range: RangeKey = isRange(sp.range) ? sp.range : "24h";
  const sort = sp.sort ?? "timestamp";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);

  // Topology is resolved before the query try/catch so a bad meter renders a
  // real 404 (notFound throws a control-flow error we must not swallow).
  let topo: Topology;
  try {
    topo = await getTopology();
  } catch (err) {
    return <DbError error={err} />;
  }
  if (!topo.allIds.includes(meter)) notFound();

  const base = `/data/${meter}`;
  const warnings =
    sp.range && !isRange(sp.range)
      ? [`Ignored unknown range "${sp.range}" — showing 24H.`]
      : [];

  try {
    const { rows, total } = await telemetryRows(meter, range, {
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages);

    return (
      <>
        <Filters title={`Data — ${meter}`} range={range} warnings={warnings} refreshSeconds={30} />

        {/* Path-based meter switcher (Filters' selector is ?meter=, which is a
            different route model — here the meter lives in the path). */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground">Meter</span>
          <div className="flex border border-border rounded-sm overflow-hidden bg-card">
            {topo.allIds.map((id) => (
              <a key={id} href={`/data/${id}${qs({ range, sort, dir })}`} className={seg(id === meter)}>
                {id}
              </a>
            ))}
          </div>
          {topo.isRoot(meter) && (
            <span className="text-[10px] text-muted-foreground normal-case">incomer / root</span>
          )}
        </div>

        {rangeTouchesCorruptWindow(range) && (
          <Notice>
            <span>
              <strong className="font-medium text-foreground">
                This range includes corrupted energy data
              </strong>{" "}
              (14–18 Aug). The <code className="normal-case">Energy (kWh)</code> column is a
              cumulative counter that returns garbage over this window; voltage, current, power,
              PF and THD are unaffected.
            </span>
          </Notice>
        )}

        <div className="grid grid-cols-12 gap-3 pb-4">
          <Panel title={`Raw readings — ${RANGES[range].label}`} span="col-span-12">
            <div className="overflow-x-auto">
              <table className="table table-bordered table-striped text-[11px] tnum">
                <thead>
                  <tr>
                    {RAW_COLUMNS.map((c) => {
                      const active = sort === c.key;
                      const nextDir = active && dir === "desc" ? "asc" : "desc";
                      const arrow = active ? (dir === "desc" ? " ▼" : " ▲") : "";
                      return (
                        <th key={c.key} className={c.kind === "num" ? "text-right" : "text-left"}>
                          <a
                            href={`${base}${qs({ range, sort: c.key, dir: nextDir })}`}
                            className={active ? "text-foreground" : "hover:text-foreground"}
                          >
                            {c.unit ? `${c.label} (${c.unit})` : c.label}
                            {arrow}
                          </a>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {RAW_COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className={
                            c.kind === "num" ? "text-right" : c.kind === "text" ? "normal-case" : ""
                          }
                        >
                          {cellText(c, row[c.col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={RAW_COLUMNS.length}
                        className="text-center text-muted-foreground normal-case"
                      >
                        No readings in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-3 flex-wrap text-[11px]">
              <span className="text-muted-foreground tnum">
                Page {clampedPage} of {totalPages} · {fmt(total, 0)} rows
              </span>
              <div className="flex border border-border rounded-sm overflow-hidden bg-card">
                {clampedPage > 1 ? (
                  <a
                    href={`${base}${qs({ range, sort, dir, page: clampedPage - 1 })}`}
                    className={seg(false)}
                  >
                    ‹ Prev
                  </a>
                ) : (
                  <span className={`${seg(false)} opacity-40 pointer-events-none`}>‹ Prev</span>
                )}
                {clampedPage < totalPages ? (
                  <a
                    href={`${base}${qs({ range, sort, dir, page: clampedPage + 1 })}`}
                    className={seg(false)}
                  >
                    Next ›
                  </a>
                ) : (
                  <span className={`${seg(false)} opacity-40 pointer-events-none`}>Next ›</span>
                )}
              </div>
              <a
                href={`${base}/export${qs({ range, sort, dir })}`}
                className="ml-auto inline-flex items-center gap-1.5 bg-brand text-white px-3 py-1.5 rounded-sm text-[11px] hover:opacity-90"
              >
                ↓ Download CSV
              </a>
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    return <DbError error={err} />;
  }
}
