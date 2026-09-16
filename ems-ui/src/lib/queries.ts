import { q, num } from "./db";

/* ---------------------------------------------------------------------------
 * Time ranges
 *
 * Postgres runs in Etc/UTC; every dashboard here reads in IST. A bare
 * date_trunc('day', now()) therefore rolls over at 05:30 IST, so the "today"
 * bound is anchored to Asia/Kolkata explicitly. This is the most expensive
 * mistake available in this schema, because it under-reports silently.
 * ------------------------------------------------------------------------- */

export const RANGES = {
  "1h": { label: "1 hour", from: "now() - interval '1 hour'", bucket: 30 },
  "6h": { label: "6 hours", from: "now() - interval '6 hours'", bucket: 180 },
  "24h": { label: "24 hours", from: "now() - interval '24 hours'", bucket: 600 },
  today: {
    label: "Today (IST)",
    from: "date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'",
    bucket: 600,
  },
  "7d": { label: "7 days", from: "now() - interval '7 days'", bucket: 3600 },
  "30d": { label: "30 days", from: "now() - interval '30 days'", bucket: 14400 },
} as const;

export type RangeKey = keyof typeof RANGES;

export function isRange(v: string | undefined): v is RangeKey {
  return !!v && v in RANGES;
}

/* ---- Time window: a preset range OR an explicit from→to span -------------- */

/** Everything time-bounded takes a Win: either a preset key or a custom span. */
export type Win = RangeKey | { fromTs: Date; toTs: Date };

export interface ResolvedWin {
  /** Full `"timestamp" >= … [AND … <= …]` SQL fragment. Safe: presets are the
      closed-enum exprs; custom bounds are interpolated from machine-generated
      ISO strings (a Date, never raw user text). */
  clause: string;
  bucket: number;
  label: string;
  fromTs: Date;
  toTs: Date;
  custom: boolean;
}

const RANGE_HOURS: Record<RangeKey, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  today: 24,
  "7d": 168,
  "30d": 720,
};

/** Bucket width for a custom span, aiming for ~200 points across the chart. */
function pickBucket(spanSec: number): number {
  const steps = [30, 60, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400];
  const target = spanSec / 200;
  return steps.find((s) => s >= target) ?? 86400;
}

function istShort(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Resolve a Win to its SQL clause, bucket and display metadata. */
export function resolveWin(win: Win): ResolvedWin {
  if (typeof win === "string") {
    const r = RANGES[win];
    const toTs = new Date();
    const fromTs = new Date(toTs.getTime() - RANGE_HOURS[win] * 3600_000);
    return {
      clause: `"timestamp" >= ${r.from}`,
      bucket: r.bucket as number,
      label: r.label,
      fromTs,
      toTs,
      custom: false,
    };
  }
  const fromISO = win.fromTs.toISOString();
  const toISO = win.toTs.toISOString();
  const spanSec = Math.max(60, (win.toTs.getTime() - win.fromTs.getTime()) / 1000);
  return {
    clause: `"timestamp" >= '${fromISO}'::timestamptz AND "timestamp" <= '${toISO}'::timestamptz`,
    bucket: pickBucket(spanSec),
    label: `${istShort(win.fromTs)} → ${istShort(win.toTs)}`,
    fromTs: win.fromTs,
    toTs: win.toTs,
    custom: true,
  };
}

export function winLabel(win: Win): string {
  return resolveWin(win).label;
}

/** A `datetime-local` value is IST wall-clock with no zone; anchor it to IST. */
function parseIstLocal(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve the page's time window from its search params: a valid `from`+`to`
 * pair wins (custom span), else the `range` preset, else 24h. Anything ignored
 * is surfaced as a warning rather than failing silently.
 */
export function windowFromParams(sp: { range?: string; from?: string; to?: string }): {
  win: Win;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (sp.from || sp.to) {
    const fromTs = parseIstLocal(sp.from);
    const toTs = parseIstLocal(sp.to);
    if (fromTs && toTs && fromTs < toTs) return { win: { fromTs, toTs }, warnings };
    warnings.push("Ignored an invalid custom range — showing 24H.");
  }
  if (sp.range && !isRange(sp.range)) {
    warnings.push(`Ignored unknown range "${sp.range}" — showing 24H.`);
  }
  return { win: isRange(sp.range) ? sp.range : "24h", warnings };
}

/** URL query fragment describing the current window, for child-page links. */
export function windowParams(sp: { range?: string; from?: string; to?: string }): string {
  const p = new URLSearchParams();
  if (sp.from && sp.to) {
    p.set("from", sp.from);
    p.set("to", sp.to);
  } else if (sp.range) {
    p.set("range", sp.range);
  }
  return p.toString();
}

/** Buckets are wide on long ranges, so say which statistic a chart is showing. */
export function bucketLabel(win: Win): string {
  const s = resolveWin(win).bucket;
  return s < 60 ? `${s}s mean` : s < 3600 ? `${s / 60}-min mean` : `${s / 3600}-hour mean`;
}

/* Energy data destroyed by the 2026-08-14 register probe. Any window overlapping
 * this shows garbage kWh/kVAh/cost. Power, PF and current are unaffected. */
export const CORRUPT_FROM = new Date("2026-08-14T05:37:00Z");
export const CORRUPT_TO = new Date("2026-08-18T04:50:00Z");

export function rangeTouchesCorruptWindow(win: Win): boolean {
  const { fromTs, toTs } = resolveWin(win);
  return fromTs < CORRUPT_TO && toTs > CORRUPT_FROM;
}

/* --------------------------------------------------------------------------- */

/** `v` is the bucket mean; `lo`/`hi` are the true extremes inside that bucket. */
export type Point = { t: string; v: number | null; lo: number | null; hi: number | null };
export type Series = { name: string; points: Point[] };

type Row = {
  bucket: Date;
  metric: string;
  value: string | number | null;
  lo: string | number | null;
  hi: string | number | null;
};

/**
 * Bucketed multi-series read carrying min/max/avg.
 *
 * Carrying the extremes matters: taking max() of bucket *means* makes peaks shrink
 * as the range widens, so a 30-day window can report a lower maximum than a 1-hour
 * window inside it. With per-bucket min/max, max(hi) is the true peak at every zoom.
 */
async function multi(
  plantId: string,
  metricExpr: string,
  valueExpr: string,
  deviceIds: string[],
  win: Win,
): Promise<Series[]> {
  if (deviceIds.length === 0) return [];
  const { clause, bucket } = resolveWin(win);
  const rows = await q<Row>(
    `SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${bucket}) * ${bucket}) AS bucket,
            ${metricExpr} AS metric,
            avg(${valueExpr}) AS value,
            min(${valueExpr}) AS lo,
            max(${valueExpr}) AS hi
       FROM energy_telemetry
      WHERE ${clause} AND device_id = ANY($1) AND plant_id = $2
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [deviceIds, plantId],
  );

  const byMetric = new Map<string, Point[]>();
  for (const r of rows) {
    const list = byMetric.get(r.metric) ?? [];
    list.push({
      t: new Date(r.bucket).toISOString(),
      v: num(r.value),
      lo: num(r.lo),
      hi: num(r.hi),
    });
    byMetric.set(r.metric, list);
  }
  return [...byMetric.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, points]) => ({ name, points }));
}

/* ---- Plant rollup (ROOT devices only — see docs/arch.md §4) --------------- */

export async function plantActivePowerKw(plantId: string, rootIds: string[]): Promise<number | null> {
  if (!rootIds.length) return null;
  const [r] = await q(
    `SELECT sum(p)/1000.0 AS kw
       FROM (SELECT DISTINCT ON (device_id) device_id, active_power AS p
               FROM energy_telemetry
              WHERE "timestamp" > now() - interval '30 seconds' AND device_id = ANY($1) AND plant_id = $2
              ORDER BY device_id, "timestamp" DESC) s`,
    [rootIds, plantId],
  );
  return num(r?.kw);
}

export async function plantEnergyTodayKwh(plantId: string, rootIds: string[]): Promise<number | null> {
  if (!rootIds.length) return null;
  const [r] = await q(
    `SELECT sum(d)/1000.0 AS kwh
       FROM (SELECT max(active_energy) - min(active_energy) AS d
               FROM energy_telemetry
              WHERE "timestamp" >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
                                   AT TIME ZONE 'Asia/Kolkata'
                AND device_id = ANY($1) AND plant_id = $2
              GROUP BY device_id) s`,
    [rootIds, plantId],
  );
  return num(r?.kwh);
}

/**
 * Plant energy over the selected window, as BOTH active (kWh) and apparent
 * (kVAh). kVAh is the billing basis, derived per root meter as kWh ÷
 * **load-weighted** PF (sum(P)/sum(P/PF)) rather than a simple average — this
 * matches the meter's own apparent-power register to <0.1% and the integrated
 * apparent energy, whereas a flat avg(PF) under-reads by ~0.5%. (The reactive
 * register is the wrong counter, so kVAh is derived, not read.)
 */
export async function plantEnergyKvah(
  plantId: string,
  rootIds: string[],
  win: Win,
): Promise<{ kwh: number | null; kvah: number | null }> {
  if (!rootIds.length) return { kwh: null, kvah: null };
  const { clause } = resolveWin(win);
  const rows = await q<{ kwh: string | number | null; lw_pf: string | number | null }>(
    `SELECT (max(active_energy) - min(active_energy))/1000.0 AS kwh,
            sum(active_power) / nullif(sum(active_power / nullif(power_factor, 0)), 0) AS lw_pf
       FROM energy_telemetry
      WHERE ${clause}
        AND device_id = ANY($1) AND plant_id = $2
      GROUP BY device_id`,
    [rootIds, plantId],
  );
  let kwh = 0;
  let kvah = 0;
  let any = false;
  for (const r of rows) {
    const k = num(r.kwh);
    const pf = num(r.lw_pf);
    if (k === null) continue;
    any = true;
    kwh += k;
    kvah += pf && pf > 0 ? k / pf : k;
  }
  return any ? { kwh, kvah } : { kwh: null, kvah: null };
}

/**
 * 15-minute load-weighted PF over the given devices. Plant PF is genuinely
 * bimodal — roughly a third of samples sit near unity, the rest at 0.87-0.92 —
 * so an instantaneous snapshot swings 0.87 to 0.99 and reads as a fault.
 */
export async function plantPowerFactor(plantId: string, deviceIds: string[]): Promise<number | null> {
  if (!deviceIds.length) return null;
  const [r] = await q(
    `SELECT sum(active_power) / nullif(sum(active_power / nullif(power_factor, 0)), 0) AS pf
       FROM energy_telemetry
      WHERE "timestamp" > now() - interval '15 minutes' AND device_id = ANY($1) AND plant_id = $2`,
    [deviceIds, plantId],
  );
  return num(r?.pf);
}

export async function metersOnline(
  plantId: string,
  deviceIds: string[],
): Promise<{ online: number; total: number }> {
  if (!deviceIds.length) return { online: 0, total: 0 };
  // NOTE: `count(DISTINCT device_id) FILTER (WHERE ...)` mis-plans to 0 on a
  // TimescaleDB hypertable — put the recency test in the WHERE clause instead of
  // an aggregate FILTER, which counts correctly across chunks.
  const [r] = await q(
    `SELECT count(DISTINCT device_id) AS online
       FROM energy_telemetry
      WHERE "timestamp" > now() - interval '60 seconds' AND device_id = ANY($1) AND plant_id = $2`,
    [deviceIds, plantId],
  );
  return { online: Number(r?.online ?? 0), total: deviceIds.length };
}

/** Coincident plant load: the summed instantaneous draw of the root set. */
export async function plantPowerSeries(
  plantId: string,
  rootIds: string[],
  win: Win,
): Promise<Series[]> {
  if (!rootIds.length) return [];
  const { clause, bucket } = resolveWin(win);
  const rows = await q<{ bucket: Date; kw: string; lo: string; hi: string }>(
    `SELECT bucket, sum(kw) AS kw, sum(lo) AS lo, sum(hi) AS hi FROM (
        SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${bucket}) * ${bucket}) AS bucket,
               device_id,
               avg(active_power)/1000.0 AS kw,
               min(active_power)/1000.0 AS lo,
               max(active_power)/1000.0 AS hi
          FROM energy_telemetry
         WHERE ${clause} AND device_id = ANY($1) AND plant_id = $2
         GROUP BY 1, 2) s
      GROUP BY bucket ORDER BY bucket`,
    [rootIds, plantId],
  );
  return [
    {
      name: "Plant kW",
      points: rows.map((r) => ({
        t: new Date(r.bucket).toISOString(),
        v: num(r.kw),
        lo: num(r.lo),
        hi: num(r.hi),
      })),
    },
  ];
}

export const powerByMeter = (plantId: string, ids: string[], w: Win) =>
  multi(plantId, "device_id", "active_power/1000.0", ids, w);

/* ---- Overview and power quality ------------------------------------------ */

export const pfByMeter = (plantId: string, ids: string[], w: Win) =>
  multi(plantId, "device_id", "power_factor", ids, w);
export const voltageByMeter = (plantId: string, ids: string[], w: Win) =>
  multi(plantId, "device_id", "voltage", ids, w);
export const currentThdByMeter = (plantId: string, ids: string[], w: Win) =>
  multi(plantId, "device_id", "current_thd", ids, w);
export const voltageThdByMeter = (plantId: string, ids: string[], w: Win) =>
  multi(plantId, "device_id", "voltage_thd", ids, w);

export const voltageImbalance = (plantId: string, ids: string[], w: Win) =>
  multi(
    plantId,
    "device_id",
    `(greatest(voltage_l1,voltage_l2,voltage_l3) - least(voltage_l1,voltage_l2,voltage_l3))
       / nullif((voltage_l1+voltage_l2+voltage_l3)/3.0, 0) * 100`,
    ids,
    w,
  );

export const currentImbalance = (plantId: string, ids: string[], w: Win) =>
  multi(
    plantId,
    "device_id",
    `(greatest(current_l1,current_l2,current_l3) - least(current_l1,current_l2,current_l3))
       / nullif((current_l1+current_l2+current_l3)/3.0, 0) * 100`,
    ids,
    w,
  );

async function perPhase(
  plantId: string,
  cols: [string, string, string],
  win: Win,
  meter: string,
): Promise<Series[]> {
  const { clause, bucket } = resolveWin(win);
  const rows = await q<Record<string, unknown>>(
    `SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${bucket}) * ${bucket}) AS bucket,
            avg(${cols[0]}) AS l1, min(${cols[0]}) AS l1lo, max(${cols[0]}) AS l1hi,
            avg(${cols[1]}) AS l2, min(${cols[1]}) AS l2lo, max(${cols[1]}) AS l2hi,
            avg(${cols[2]}) AS l3, min(${cols[2]}) AS l3lo, max(${cols[2]}) AS l3hi
       FROM energy_telemetry
      WHERE ${clause} AND device_id = $1 AND plant_id = $2
      GROUP BY 1 ORDER BY 1`,
    [meter, plantId],
  );
  const at = (k: "l1" | "l2" | "l3") =>
    rows.map((r) => ({
      t: new Date(r.bucket as Date).toISOString(),
      v: num(r[k]),
      lo: num(r[`${k}lo`]),
      hi: num(r[`${k}hi`]),
    }));
  return [
    { name: "L1", points: at("l1") },
    { name: "L2", points: at("l2") },
    { name: "L3", points: at("l3") },
  ];
}

export const perPhaseVoltage = (plantId: string, w: Win, m: string) =>
  perPhase(plantId, ["voltage_l1", "voltage_l2", "voltage_l3"], w, m);
export const perPhaseCurrent = (plantId: string, w: Win, m: string) =>
  perPhase(plantId, ["current_l1", "current_l2", "current_l3"], w, m);

/**
 * Downside statistics for power factor. A chart about penalty risk should report
 * how low it went and how long it stayed there, not its maximum.
 */
export type PfStat = {
  deviceId: string;
  min: number | null;
  avg: number | null;
  pctBelow: number | null;
};

export async function pfStats(
  plantId: string,
  deviceIds: string[],
  win: Win,
  threshold = 0.9,
): Promise<PfStat[]> {
  if (!deviceIds.length) return [];
  const { clause } = resolveWin(win);
  const rows = await q(
    `SELECT device_id, min(power_factor) AS lo, avg(power_factor) AS mean,
            100.0 * count(*) FILTER (WHERE power_factor < $2) / nullif(count(*),0) AS pct_below
       FROM energy_telemetry
      WHERE ${clause} AND device_id = ANY($1) AND plant_id = $3 AND power_factor IS NOT NULL
      GROUP BY device_id ORDER BY device_id`,
    [deviceIds, threshold, plantId],
  );
  return rows.map((r) => ({
    deviceId: String(r.device_id),
    min: num(r.lo),
    avg: num(r.mean),
    pctBelow: num(r.pct_below),
  }));
}

/**
 * Distinct device ids that have written telemetry, scoped to one plant. Used to
 * find drift between the plant's register map and what is actually reporting, so
 * it MUST be plant-scoped — otherwise another plant's meters surface here as
 * bogus "orphans" (device_id is only unique within a plant).
 */
export async function meterList(plantId: string): Promise<string[]> {
  const rows = await q<{ device_id: string }>(
    `SELECT DISTINCT device_id FROM energy_telemetry WHERE plant_id = $1 ORDER BY 1`,
    [plantId],
  );
  return rows.map((r) => r.device_id);
}

/* ---- Distribution: a node against its children ---------------------------- */

export type Distribution = {
  nodeId: string;
  nodeKwh: number | null;
  children: { deviceId: string; kwh: number | null; pct: number | null }[];
  unattributedKwh: number | null;
  unattributedPct: number | null;
};

/**
 * Energy balance for one node. Compared on energy deltas, never instantaneous
 * power: minute-level parent/child ratios swing 0.46-1.30 purely from poll skew
 * between meters, while the same comparison on energy is stable.
 */
export async function distributionFor(
  plantId: string,
  nodeId: string,
  childIds: string[],
  win: Win,
): Promise<Distribution> {
  const { clause } = resolveWin(win);
  const rows = await q(
    `SELECT device_id, (max(active_energy) - min(active_energy))/1000.0 AS kwh
       FROM energy_telemetry
      WHERE ${clause} AND device_id = ANY($1) AND plant_id = $2
      GROUP BY device_id`,
    [[nodeId, ...childIds], plantId],
  );
  const kwhOf = (id: string) => num(rows.find((r) => r.device_id === id)?.kwh ?? null);

  const nodeKwh = kwhOf(nodeId);
  const children = childIds.map((id) => {
    const kwh = kwhOf(id);
    return {
      deviceId: id,
      kwh,
      pct: nodeKwh && kwh !== null ? (kwh / nodeKwh) * 100 : null,
    };
  });
  const childSum = children.reduce((a, c) => a + (c.kwh ?? 0), 0);
  const unattributedKwh = nodeKwh === null ? null : nodeKwh - childSum;

  return {
    nodeId,
    nodeKwh,
    children,
    unattributedKwh,
    unattributedPct:
      nodeKwh && unattributedKwh !== null ? (unattributedKwh / nodeKwh) * 100 : null,
  };
}

/* ---- Incomer breakdown: the plant split across its roots ------------------ */

export type IncomerShare = { deviceId: string; kwh: number | null; pct: number | null };
export type PlantBreakdown = { totalKwh: number | null; incomers: IncomerShare[] };

/**
 * Plant energy split across its incomers (root meters). Each root is an
 * independent utility incomer whose feed does not overlap the others, so the
 * plant total is their sum and each root's share is a real fraction of plant
 * consumption — not a parent/child ratio. Energy deltas, never instantaneous
 * power (poll skew between meters makes minute-level ratios unreliable).
 *
 * This is the correct "where the energy comes in" view for a multi-incomer
 * plant; `distributionFor` remains the view for a true parent-vs-children tree.
 */
export async function incomerBreakdown(
  plantId: string,
  rootIds: string[],
  win: Win,
): Promise<PlantBreakdown> {
  if (!rootIds.length) return { totalKwh: null, incomers: [] };
  const { clause } = resolveWin(win);
  const rows = await q<{ device_id: string; kwh: string | number | null }>(
    `SELECT device_id, (max(active_energy) - min(active_energy))/1000.0 AS kwh
       FROM energy_telemetry
      WHERE ${clause} AND device_id = ANY($1) AND plant_id = $2
      GROUP BY device_id`,
    [rootIds, plantId],
  );
  const kwhOf = (id: string) => num(rows.find((r) => r.device_id === id)?.kwh ?? null);
  const rawer = rootIds.map((id) => ({ deviceId: id, kwh: kwhOf(id) }));
  const total = rawer.reduce((a, c) => a + (c.kwh ?? 0), 0);
  const totalKwh = rawer.some((c) => c.kwh !== null) ? total : null;
  const incomers = rawer
    .map((c) => ({
      deviceId: c.deviceId,
      kwh: c.kwh,
      pct: totalKwh && totalKwh > 0 && c.kwh !== null ? (c.kwh / totalKwh) * 100 : null,
    }))
    // Largest incomer first — reads as a ranked contribution list.
    .sort((a, b) => (b.kwh ?? -1) - (a.kwh ?? -1));
  return { totalKwh, incomers };
}

/* ---- Cost and demand ------------------------------------------------------ */

export type MeterCost = {
  deviceId: string;
  kwh: number | null;
  pf: number | null;
  kvah: number | null;
  cost: number | null;
};

/**
 * kVAh derived as kWh / PF, NOT sqrt(kWh^2 + kVArh^2).
 *
 * The meter's reactive_energy register is the CAPACITIVE counter, which barely
 * moves on an inductive plant, so the sqrt form collapses to kWh and understates
 * the bill by roughly 7%. The correct long-term fix is the meter's own VAh counter,
 * which is not yet mapped.
 */
export async function costByMeter(
  plantId: string,
  deviceIds: string[],
  win: Win,
  tariff: number,
): Promise<MeterCost[]> {
  if (!deviceIds.length) return [];
  const { clause } = resolveWin(win);
  const rows = await q(
    `SELECT device_id,
            (max(active_energy) - min(active_energy))/1000.0 AS kwh,
            avg(power_factor) AS pf,
            (max(active_energy) - min(active_energy))/1000.0
              / nullif(avg(power_factor), 0) AS kvah
       FROM energy_telemetry
      WHERE ${clause} AND device_id = ANY($1) AND plant_id = $2
      GROUP BY device_id ORDER BY device_id`,
    [deviceIds, plantId],
  );
  return rows.map((r) => {
    const kvah = num(r.kvah);
    return {
      deviceId: String(r.device_id),
      kwh: num(r.kwh),
      pf: num(r.pf),
      kvah,
      cost: kvah === null ? null : kvah * tariff,
    };
  });
}

export type DemandResult = {
  /** Coincident: the summed load of the device set, peaked over fixed blocks. */
  coincidentKva: number | null;
  atBlock: string | null;
  blockMinutes: number;
  /** Each device's own peak block — a diversity diagnostic, NOT additive. */
  perDevice: { deviceId: string; kva: number | null; atBlock: string | null }[];
};

/**
 * Maximum demand over fixed, clock-aligned blocks.
 *
 * Two things this deliberately does not do. It does not sum each meter's
 * individual peak — those peaks occur at different times, and summing them
 * overstates demand. And it does not read the meter's `maximum_demand` register,
 * which is a latched lifetime peak that ignores the selected range entirely.
 *
 * kVA is derived as kW / PF for consistency with how kVAh is computed elsewhere.
 */
export async function coincidentMaxDemand(
  plantId: string,
  deviceIds: string[],
  win: Win,
  blockMinutes = 30,
): Promise<DemandResult> {
  const empty: DemandResult = {
    coincidentKva: null,
    atBlock: null,
    blockMinutes,
    perDevice: [],
  };
  if (!deviceIds.length) return empty;

  const { clause } = resolveWin(win);
  const secs = blockMinutes * 60;
  const blocks = `
    SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${secs}) * ${secs}) AS blk,
           device_id,
           avg(active_power / nullif(power_factor, 0))/1000.0 AS kva
      FROM energy_telemetry
     WHERE ${clause} AND device_id = ANY($1) AND plant_id = $2
     GROUP BY 1, 2`;

  const [top] = await q(
    `SELECT blk, sum(kva) AS kva FROM (${blocks}) d
      GROUP BY blk ORDER BY sum(kva) DESC NULLS LAST LIMIT 1`,
    [deviceIds, plantId],
  );

  const per = await q(
    `SELECT DISTINCT ON (device_id) device_id, blk, kva
       FROM (${blocks}) d ORDER BY device_id, kva DESC NULLS LAST`,
    [deviceIds, plantId],
  );

  return {
    coincidentKva: num(top?.kva),
    atBlock: top?.blk ? new Date(top.blk as Date).toISOString() : null,
    blockMinutes,
    perDevice: per.map((r) => ({
      deviceId: String(r.device_id),
      kva: num(r.kva),
      atBlock: r.blk ? new Date(r.blk as Date).toISOString() : null,
    })),
  };
}

export const reactiveEnergyByMeter = (plantId: string, ids: string[], w: Win) =>
  multi(plantId, "device_id", "reactive_energy/1000.0", ids, w);

/* ---- Per-device snapshot (Topology section) ------------------------------- */

export type DeviceSnapshot = {
  deviceId: string;
  lastSeen: string | null;
  ageSeconds: number | null;
  kw: number | null;
  pf: number | null;
  kwhToday: number | null;
  samplesToday: number;
};

/**
 * One row per device: liveness plus today's contribution.
 *
 * Bound to the device list from the register map rather than to whatever happens
 * to be in the telemetry table, so a configured meter that has never reported
 * still appears — as a gap, which is the point.
 */
export async function deviceSnapshots(plantId: string, ids: string[]): Promise<DeviceSnapshot[]> {
  if (!ids.length) return [];
  const rows = await q(
    `WITH latest AS (
        SELECT DISTINCT ON (device_id) device_id, "timestamp", active_power, power_factor
          FROM energy_telemetry
         WHERE "timestamp" > now() - interval '7 days' AND device_id = ANY($1) AND plant_id = $2
         ORDER BY device_id, "timestamp" DESC
     ), today AS (
        SELECT device_id,
               max(active_energy) - min(active_energy) AS wh,
               count(*) AS samples
          FROM energy_telemetry
         WHERE device_id = ANY($1) AND plant_id = $2
           AND "timestamp" >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
                              AT TIME ZONE 'Asia/Kolkata'
         GROUP BY device_id
     )
     SELECT d.id AS device_id, l."timestamp" AS last_seen,
            extract(epoch from (now() - l."timestamp")) AS age_s,
            l.active_power/1000.0 AS kw, l.power_factor AS pf,
            t.wh/1000.0 AS kwh_today, coalesce(t.samples, 0) AS samples
       FROM unnest($1::text[]) AS d(id)
       LEFT JOIN latest l ON l.device_id = d.id
       LEFT JOIN today  t ON t.device_id = d.id
      ORDER BY d.id`,
    [ids, plantId],
  );
  return rows.map((r) => ({
    deviceId: String(r.device_id),
    lastSeen: r.last_seen ? new Date(r.last_seen as Date).toISOString() : null,
    ageSeconds: num(r.age_s),
    kw: num(r.kw),
    pf: num(r.pf),
    kwhToday: num(r.kwh_today),
    samplesToday: Number(r.samples ?? 0),
  }));
}

/* ---- Raw reading log (the /data/[meter] Data Table page) ------------------
 *
 * One row per polled sample, straight from energy_telemetry — for auditing a
 * reading against the meter LCD and exporting for reports. Columns are DATA
 * (RAW_COLUMNS), shared by the page header, the cells, the sort whitelist and
 * the CSV export so the four never drift apart. `sort`/`dir` come from the URL,
 * so both are resolved through the whitelist before touching SQL (ORDER BY
 * cannot be parameterised); device id and limits are bound as $1/$2/$3.
 * ------------------------------------------------------------------------- */

export type RawColKind = "time" | "text" | "num";

export interface RawColumn {
  /** URL sort key and the property read off each row. */
  key: string;
  /** Physical column in energy_telemetry — a FIXED literal, never user input. */
  col: string;
  label: string;
  unit: string;
  kind: RawColKind;
  /** Multiply the stored value for display (W→kW, VA→kVA, Wh→kWh…). */
  scale?: number;
  decimals?: number;
}

export const RAW_COLUMNS: readonly RawColumn[] = [
  { key: "timestamp", col: "timestamp", label: "Time", unit: "IST", kind: "time" },
  { key: "quality", col: "quality", label: "Quality", unit: "", kind: "text" },
  { key: "voltage", col: "voltage", label: "V", unit: "V", kind: "num", decimals: 1 },
  { key: "current", col: "current", label: "A", unit: "A", kind: "num", decimals: 1 },
  { key: "active_power", col: "active_power", label: "kW", unit: "kW", kind: "num", scale: 0.001, decimals: 2 },
  { key: "apparent_power", col: "apparent_power", label: "kVA", unit: "kVA", kind: "num", scale: 0.001, decimals: 2 },
  { key: "reactive_power", col: "reactive_power", label: "kVAr", unit: "kVAr", kind: "num", scale: 0.001, decimals: 2 },
  { key: "power_factor", col: "power_factor", label: "PF", unit: "", kind: "num", decimals: 3 },
  { key: "frequency", col: "frequency", label: "Freq", unit: "Hz", kind: "num", decimals: 2 },
  { key: "active_energy", col: "active_energy", label: "Energy", unit: "kWh", kind: "num", scale: 0.001, decimals: 1 },
  { key: "voltage_thd", col: "voltage_thd", label: "V-THD", unit: "%", kind: "num", decimals: 1 },
  { key: "current_thd", col: "current_thd", label: "I-THD", unit: "%", kind: "num", decimals: 1 },
] as const;

const RAW_BY_KEY = new Map(RAW_COLUMNS.map((c) => [c.key, c]));
const RAW_SELECT = RAW_COLUMNS.map((c) => `"${c.col}"`).join(", ");

export type SortDir = "asc" | "desc";
export type RawRow = Record<string, unknown>;

export function isSortKey(v: string | undefined): boolean {
  return !!v && RAW_BY_KEY.has(v);
}

/** Scale a stored value for display/export (null-safe). */
export function rawNumber(col: RawColumn, v: unknown): number | null {
  const n = num(v);
  return n === null ? null : n * (col.scale ?? 1);
}

/** Build a whitelisted ORDER BY. Unknown keys fall back to timestamp DESC. */
function rawOrderBy(sort: string | undefined, dir: string | undefined): string {
  const key = isSortKey(sort) ? (sort as string) : "timestamp";
  const col = RAW_BY_KEY.get(key)!.col;
  const d: SortDir = dir === "asc" ? "asc" : "desc";
  // A timestamp tiebreak keeps paging stable when the sort column ties.
  const tiebreak = col === "timestamp" ? "" : `, "timestamp" DESC`;
  return `ORDER BY "${col}" ${d}${tiebreak}`;
}

export interface RawPageOpts {
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
}

/** One page of raw readings for a single device, plus the total row count. */
export async function telemetryRows(
  plantId: string,
  deviceId: string,
  win: Win,
  opts: RawPageOpts = {},
): Promise<{ rows: RawRow[]; total: number }> {
  const { clause } = resolveWin(win);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);

  const rows = await q<RawRow>(
    `SELECT ${RAW_SELECT}
       FROM energy_telemetry
      WHERE ${clause} AND device_id = $1 AND plant_id = $4
      ${rawOrderBy(opts.sort, opts.dir)}
      LIMIT $2 OFFSET $3`,
    [deviceId, pageSize, (page - 1) * pageSize, plantId],
  );
  const [c] = await q<{ n: string }>(
    `SELECT count(*) AS n
       FROM energy_telemetry
      WHERE ${clause} AND device_id = $1 AND plant_id = $2`,
    [deviceId, plantId],
  );
  return { rows, total: Number(c?.n ?? 0) };
}

/** The whole range for CSV export (no paging), hard-capped so it can't OOM. */
export async function telemetryRowsForExport(
  plantId: string,
  deviceId: string,
  win: Win,
  opts: { sort?: string; dir?: string; cap?: number } = {},
): Promise<{ rows: RawRow[]; capped: boolean; cap: number }> {
  const { clause } = resolveWin(win);
  const cap = Math.min(Math.max(opts.cap ?? 100_000, 1), 500_000);
  const rows = await q<RawRow>(
    `SELECT ${RAW_SELECT}
       FROM energy_telemetry
      WHERE ${clause} AND device_id = $1 AND plant_id = $3
      ${rawOrderBy(opts.sort, opts.dir)}
      LIMIT $2`,
    [deviceId, cap + 1, plantId],
  );
  const capped = rows.length > cap;
  return { rows: capped ? rows.slice(0, cap) : rows, capped, cap };
}
