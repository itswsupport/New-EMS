"use client";

import { DataGrid, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import * as XLSX from "xlsx";
import type { DataCell, DataColumn, DataRow } from "@/lib/datatable";

/**
 * MUI X Data Grid, themed to the app (see MuiProvider). Pages keep passing the
 * same `{ columns, rows }` shape — each cell is `{ t: text, v: sortValue }`, so
 * the grid sorts/filters on `v` (numeric columns get numeric operators) and
 * renders the pre-formatted `t`. Toolbar gives quick search, per-column filters,
 * column show/hide and density. When `exportName` is set, an Export Excel button
 * writes the full table to `.xlsx` (SheetJS) — numeric columns export as numbers.
 */
export default function DataTable({
  columns,
  rows,
  initialPageSize = 25,
  filterable = true,
  initialSortKey,
  initialDir = "asc",
  exportName,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  initialPageSize?: number;
  filterable?: boolean;
  initialSortKey?: string;
  initialDir?: "asc" | "desc";
  exportName?: string;
}) {
  const gridColumns: GridColDef[] = columns.map((c) => {
    const numeric = c.align === "right";
    return {
      field: c.key,
      headerName: c.label,
      flex: 1,
      minWidth: numeric ? 90 : 130,
      type: numeric ? "number" : "string",
      headerAlign: c.align ?? "left",
      align: c.align ?? "left",
      filterable,
      valueGetter: (value) => (value as DataCell | undefined)?.v ?? null,
      renderCell: (params: GridRenderCellParams) => {
        const cell = params.row[c.key] as DataCell | undefined;
        const text = cell?.t ?? "—";
        const cls = `${c.preserveCase ? "normal-case" : ""} ${cell?.cls ?? ""}`.trim();
        return cls ? <span className={cls}>{text}</span> : text;
      },
    };
  });

  const gridRows = rows.map((r, i) => ({ id: i, ...r }));

  const visible = Math.min(Math.max(rows.length, 1), initialPageSize);
  const height = Math.min(640, 150 + visible * 36);

  const exportExcel = () => {
    const header = columns.map((c) => c.label);
    const body = rows.map((r) =>
      columns.map((c) => {
        const cell = r[c.key];
        if (!cell) return "";
        // Numeric columns export as real numbers; text/time as their display value.
        return c.align === "right" && typeof cell.v === "number" ? cell.v : cell.t;
      }),
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${exportName ?? "export"}.xlsx`);
  };

  return (
    <div>
      {exportName && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex items-center gap-1.5 bg-brand text-white px-3 py-1.5 rounded-sm text-[11px] hover:opacity-90"
          >
            ⤓ Export Excel
          </button>
        </div>
      )}
      <div style={{ width: "100%", height }}>
        <DataGrid
          rows={gridRows}
          columns={gridColumns}
          density="compact"
          showToolbar={filterable}
          disableColumnMenu={!filterable}
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: initialPageSize, page: 0 } },
            ...(initialSortKey
              ? { sorting: { sortModel: [{ field: initialSortKey, sort: initialDir }] } }
              : {}),
          }}
          sx={{
            "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within": { outline: "none" },
            "& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within": {
              outline: "none",
            },
          }}
        />
      </div>
    </div>
  );
}
