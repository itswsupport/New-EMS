"use client";

import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
  type GridRenderCellParams,
  type GridSortModel,
} from "@mui/x-data-grid";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DataCell, DataColumn, DataRow } from "@/lib/datatable";

/**
 * Server-paginated Data Grid: pagination and sorting are driven by the URL and
 * resolved by the server component (SSR), so only the current page is fetched
 * from Postgres — this scales to unlimited rows. Excel export (full filtered
 * range) is a server route linked via `exportHref`.
 */
export default function ServerDataTable({
  columns,
  rows,
  rowCount,
  page,
  pageSize,
  sort,
  dir,
  exportHref,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  rowCount: number;
  /** 1-based page. */
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  exportHref?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();

  const pushWith = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    router.push(`${path}?${p.toString()}`);
  };

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
      filterable: false,
      valueGetter: (value) => (value as DataCell | undefined)?.v ?? null,
      renderCell: (p: GridRenderCellParams) => {
        const cell = p.row[c.key] as DataCell | undefined;
        const text = cell?.t ?? "—";
        const cls = `${c.preserveCase ? "normal-case" : ""} ${cell?.cls ?? ""}`.trim();
        return cls ? <span className={cls}>{text}</span> : text;
      },
    };
  });

  const gridRows = rows.map((r, i) => ({ id: (page - 1) * pageSize + i, ...r }));

  const onPage = (m: GridPaginationModel) => {
    pushWith({ page: String(m.page + 1), pageSize: String(m.pageSize) });
  };
  const onSort = (m: GridSortModel) => {
    if (m.length && m[0].sort) pushWith({ sort: m[0].field, dir: m[0].sort, page: "1" });
    else pushWith({ page: "1" });
  };

  return (
    <div>
      {exportHref && (
        <div className="mb-2 flex justify-end">
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 bg-brand text-white px-3 py-1.5 rounded-sm text-[11px] hover:opacity-90"
          >
            ⤓ Export Excel
          </a>
        </div>
      )}
      <div style={{ width: "100%", height: 640 }}>
        <DataGrid
          rows={gridRows}
          columns={gridColumns}
          density="compact"
          disableColumnMenu
          disableRowSelectionOnClick
          paginationMode="server"
          sortingMode="server"
          rowCount={rowCount}
          paginationModel={{ page: page - 1, pageSize }}
          sortModel={sort ? [{ field: sort, sort: dir }] : []}
          onPaginationModelChange={onPage}
          onSortModelChange={onSort}
          pageSizeOptions={[25, 50, 100, 200]}
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
