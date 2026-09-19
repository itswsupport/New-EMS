import {
  apparentPowerByMeter,
  currentImbalance,
  currentThdByMeter,
  frequencyByMeter,
  perPhaseActivePower,
  perPhaseCurrent,
  perPhasePowerFactor,
  perPhaseVoltage,
  pfByMeter,
  plantPowerSeries,
  powerByMeter,
  reactivePowerByMeter,
  voltageByMeter,
  voltageImbalance,
  voltageThdByMeter,
  type Series,
  type Win,
} from "./queries";

/**
 * Chart registry — the bridge that lets a chart's "Table" button open a full
 * page (`/chart/<slug>`) showing the SAME data the chart plots. A chart is
 * metric-specific, so the page must re-run that metric's query from the URL
 * alone; this maps each slug to exactly the call its chart already makes.
 */

export interface ChartCtx {
  plantId: string;
  allIds: string[];
  rootIds: string[];
  /** Selected meter — used only by the per-phase charts. */
  meter: string;
}

export interface ChartDef {
  slug: string;
  title: string;
  unit: string;
  decimals: number;
  /** Per-phase charts are scoped to one meter; the page shows a meter selector. */
  needsMeter?: boolean;
  load: (win: Win, ctx: ChartCtx) => Promise<Series[]>;
}

export const CHARTS: readonly ChartDef[] = [
  { slug: "plant-power", title: "Plant total active power", unit: "kW", decimals: 0,
    load: (r, c) => plantPowerSeries(c.plantId, c.rootIds, r) },
  { slug: "power", title: "Active power by meter", unit: "kW", decimals: 0,
    load: (r, c) => powerByMeter(c.plantId, c.allIds, r) },
  { slug: "pf", title: "Power factor by meter", unit: "", decimals: 3,
    load: (r, c) => pfByMeter(c.plantId, c.allIds, r) },
  { slug: "reactive-power", title: "Reactive power by meter (derived)", unit: "kVAr", decimals: 1,
    load: (r, c) => reactivePowerByMeter(c.plantId, c.allIds, r) },
  { slug: "apparent-power", title: "Apparent power by meter", unit: "kVA", decimals: 1,
    load: (r, c) => apparentPowerByMeter(c.plantId, c.allIds, r) },
  { slug: "frequency", title: "Grid frequency by meter", unit: "Hz", decimals: 2,
    load: (r, c) => frequencyByMeter(c.plantId, c.allIds, r) },
  { slug: "voltage", title: "System average voltage by meter", unit: "V", decimals: 1,
    load: (r, c) => voltageByMeter(c.plantId, c.allIds, r) },
  { slug: "voltage-thd", title: "Voltage THD by meter", unit: "%", decimals: 2,
    load: (r, c) => voltageThdByMeter(c.plantId, c.allIds, r) },
  { slug: "current-thd", title: "Current THD by meter", unit: "%", decimals: 2,
    load: (r, c) => currentThdByMeter(c.plantId, c.allIds, r) },
  { slug: "voltage-imbalance", title: "Voltage imbalance by meter", unit: "%", decimals: 2,
    load: (r, c) => voltageImbalance(c.plantId, c.allIds, r) },
  { slug: "current-imbalance", title: "Current imbalance by meter", unit: "%", decimals: 2,
    load: (r, c) => currentImbalance(c.plantId, c.allIds, r) },
  { slug: "per-phase-voltage", title: "Per-phase voltage", unit: "V", decimals: 1, needsMeter: true,
    load: (r, c) => perPhaseVoltage(c.plantId, r, c.meter) },
  { slug: "per-phase-current", title: "Per-phase current", unit: "A", decimals: 1, needsMeter: true,
    load: (r, c) => perPhaseCurrent(c.plantId, r, c.meter) },
  { slug: "per-phase-power", title: "Per-phase active power", unit: "kW", decimals: 1, needsMeter: true,
    load: (r, c) => perPhaseActivePower(c.plantId, r, c.meter) },
  { slug: "per-phase-pf", title: "Per-phase power factor", unit: "", decimals: 3, needsMeter: true,
    load: (r, c) => perPhasePowerFactor(c.plantId, r, c.meter) },
];

const BY_SLUG = new Map(CHARTS.map((c) => [c.slug, c]));

export function chartBySlug(slug: string): ChartDef | undefined {
  return BY_SLUG.get(slug);
}

export interface ChartTable {
  /** Series names, in the order the chart draws them. */
  columns: string[];
  rows: { t: string; vals: Record<string, number | null> }[];
}

/**
 * Pivot the plotted series into a table: one row per time bucket, one column
 * per series. Keyed by timestamp (not index) so a meter with gaps still lines
 * up. `sort`/`dir` come from the URL — "time" or a series name, defaulting to
 * newest-first. The bucketed series are bounded (≤ a few hundred rows), so the
 * sort is a cheap in-memory pass and the page needs no pagination.
 */
export function pivotSeries(
  series: Series[],
  sort: string | undefined,
  dir: string | undefined,
): ChartTable {
  const columns = series.map((s) => s.name);
  const rowMap = new Map<string, Record<string, number | null>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = rowMap.get(p.t) ?? {};
      row[s.name] = p.v;
      rowMap.set(p.t, row);
    }
  }

  const rows = [...rowMap.entries()].map(([t, vals]) => ({ t, vals }));
  const key = sort && (sort === "time" || columns.includes(sort)) ? sort : "time";
  const asc = dir === "asc";
  rows.sort((a, b) => {
    let cmp: number;
    if (key === "time") {
      cmp = a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
    } else {
      const an = a.vals[key] ?? Number.NEGATIVE_INFINITY;
      const bn = b.vals[key] ?? Number.NEGATIVE_INFINITY;
      cmp = an - bn;
    }
    return asc ? cmp : -cmp;
  });

  return { columns, rows };
}
