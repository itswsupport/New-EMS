import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import { RAW_COLUMNS, rawNumber, telemetryRowsForExport, windowFromParams } from "@/lib/queries";

export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";

/** "YYYY-MM-DD HH:MM:SS" in IST. */
function istStamp(v: unknown): string {
  return new Date(v as string).toLocaleString("sv-SE", { timeZone: IST });
}

/**
 * Full filtered range as an .xlsx (SheetJS, server-side). Numeric columns are
 * written as real numbers; the window comes from the same params the page uses,
 * capped so a huge span can't exhaust memory.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meter: string }> },
) {
  const { meter } = await params;

  const { plant } = await getSelectedPlant();
  const topo = await getTopology(plant);
  if (!topo.allIds.includes(meter)) {
    return new NextResponse("Unknown meter", { status: 404 });
  }

  const q = req.nextUrl.searchParams;
  const { win } = windowFromParams({
    range: q.get("range") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
  });
  const sort = q.get("sort") ?? "timestamp";
  const dir = q.get("dir") === "asc" ? "asc" : "desc";

  const { rows, capped, cap } = await telemetryRowsForExport(meter, win, {
    sort,
    dir,
    cap: 100_000,
  });

  const header = RAW_COLUMNS.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label));
  const body: (string | number | null)[][] = rows.map((row) =>
    RAW_COLUMNS.map((c) => {
      const v = row[c.col];
      if (c.kind === "time") return istStamp(v);
      if (c.kind === "text") return v == null ? "" : String(v);
      return rawNumber(c, v);
    }),
  );
  const aoa: (string | number | null)[][] = [header, ...body];
  if (capped) aoa.push([`NOTE: truncated at ${cap} rows — narrow the range for the full set`]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Readings");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ems_${meter}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
