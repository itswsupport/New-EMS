import { NextResponse, type NextRequest } from "next/server";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import { isRange, type RangeKey } from "@/lib/queries";
import { chartBySlug, pivotSeries } from "@/lib/charts";

export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";

/** "YYYY-MM-DD HH:MM:SS" in IST — sv-SE renders exactly that shape. */
function csvTimestamp(v: string): string {
  return new Date(v).toLocaleString("sv-SE", { timeZone: IST });
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of a chart's data (Time × each series), matching the /chart/[metric] view. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ metric: string }> },
) {
  const { metric } = await params;
  const def = chartBySlug(metric);
  if (!def) return new NextResponse("Unknown chart", { status: 404 });

  const { plant } = await getSelectedPlant();
  const topo = await getTopology(plant);
  const sp = req.nextUrl.searchParams;
  const rawRange = sp.get("range") ?? undefined;
  const range: RangeKey = isRange(rawRange) ? rawRange : "24h";
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const sort = sp.get("sort") ?? "time";
  const meterParam = sp.get("meter") ?? undefined;
  const meter =
    meterParam && topo.allIds.includes(meterParam) ? meterParam : topo.allIds[0] ?? "";

  const series = await def.load(range, { plantId: plant, allIds: topo.allIds, rootIds: topo.rootIds, meter });
  const { columns, rows } = pivotSeries(series, sort, dir);

  const unit = def.unit ? ` (${def.unit})` : "";
  const header = ["Timestamp (IST)", ...columns.map((c) => `${c}${unit}`)]
    .map(csvEscape)
    .join(",");
  const lines = rows.map((r) =>
    [
      csvTimestamp(r.t),
      ...columns.map((c) => {
        const v = r.vals[c];
        return v === null || v === undefined ? "" : v.toFixed(def.decimals);
      }),
    ].join(","),
  );

  const body = "﻿" + header + "\n" + lines.join("\n") + "\n";
  const fname = def.needsMeter
    ? `ems_${metric}_${meter}_${range}.csv`
    : `ems_${metric}_${range}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
