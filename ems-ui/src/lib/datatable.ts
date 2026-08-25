/**
 * Serializable shapes shared by the server (which formats cells) and the client
 * DataTable (which sorts/searches/paginates). Functions can't cross the RSC
 * boundary, so a page pre-renders every cell to `{ t: text, v: sortValue }` and
 * the client operates on those — units and formatting stay on the server, all
 * interactivity stays on the client.
 */

export interface DataColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Preserve case — global CSS uppercases display text by default. */
  preserveCase?: boolean;
}

export interface DataCell {
  /** Display text (already formatted / unit-scaled). */
  t: string;
  /** Value used for sorting and search; a number sorts numerically. */
  v: string | number | null;
  /** Optional extra classes for this <td> (e.g. "text-bad" for a warning cell). */
  cls?: string;
}

export type DataRow = Record<string, DataCell>;

/** Numeric cell: pre-formatted text plus the raw number used for sorting. */
export function numCell(value: number | null, text: string, cls?: string): DataCell {
  return { t: text, v: value, cls };
}

/** Text cell: sorts and searches on its own text. */
export function textCell(text: string, cls?: string): DataCell {
  return { t: text, v: text, cls };
}

/** Time cell: display text plus a sortable ISO key. */
export function timeCell(text: string, isoKey: string, cls?: string): DataCell {
  return { t: text, v: isoKey, cls };
}
