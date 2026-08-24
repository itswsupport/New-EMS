import { NextResponse, type NextRequest } from "next/server";
import { getTopology } from "@/lib/topology";
import {
  isRange,
  RAW_COLUMNS,
  rawNumber,
  telemetryRowsForExport,
  type RangeKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";

/** "YYYY-MM-DD HH:MM:SS" in IST — sv-SE renders exactly that shape. */
function csvTimestamp(v: unknown): string {
  return new Date(v as string).toLocaleString("sv-SE", { timeZone: IST });
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of the raw reading log for one meter over the current range/sort. Numbers
 * are unit-converted but WITHOUT thousands separators, so Excel parses them as
 * numbers; the unit lives in the header. UTF-8 BOM so Excel reads it correctly.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meter: string }> },
) {
  const { meter } = await params;

  const topo = await getTopology();
  if (!topo.allIds.includes(meter)) {
    return new NextResponse("Unknown meter", { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const rawRange = sp.get("range") ?? undefined;
  const range: RangeKey = isRange(rawRange) ? rawRange : "24h";
  const sort = sp.get("sort") ?? "timestamp";
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";

  const { rows, capped, cap } = await telemetryRowsForExport(meter, range, { sort, dir });

  const header = RAW_COLUMNS.map((c) =>
    csvEscape(c.unit ? `${c.label} (${c.unit})` : c.label),
  ).join(",");

  const lines = rows.map((row) =>
    RAW_COLUMNS.map((c) => {
      const v = row[c.col];
      if (c.kind === "time") return csvTimestamp(v);
      if (c.kind === "text") return csvEscape(v == null ? "" : String(v));
      const n = rawNumber(c, v);
      return n === null ? "" : n.toFixed(c.decimals ?? 1);
    }).join(","),
  );

  let body = "﻿" + header + "\n" + lines.join("\n") + "\n";
  if (capped) {
    body += `# NOTE: export truncated at ${cap} rows — narrow the range for a complete extract\n`;
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ems_${meter}_${range}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
