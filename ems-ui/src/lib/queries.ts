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

/** Range keys come from a closed enum, never from user text. */
function bounds(range: RangeKey) {
  const r = RANGES[range];
  return { from: r.from as string, bucket: r.bucket as number };
}

/** Buckets are wide on long ranges, so say which statistic a chart is showing. */
export function bucketLabel(range: RangeKey): string {
  const s = RANGES[range].bucket as number;
  return s < 60 ? `${s}s mean` : s < 3600 ? `${s / 60}-min mean` : `${s / 3600}-hour mean`;
}

/* Energy data destroyed by the 2026-08-14 register probe. Any range overlapping
 * this window shows garbage kWh/kVAh/cost. Power, PF and current are unaffected. */
export const CORRUPT_FROM = new Date("2026-08-14T05:37:00Z");
export const CORRUPT_TO = new Date("2026-08-18T04:50:00Z");

const RANGE_HOURS: Record<RangeKey, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  today: 24,
  "7d": 168,
  "30d": 720,
};

export function rangeTouchesCorruptWindow(range: RangeKey): boolean {
  const start = new Date(Date.now() - RANGE_HOURS[range] * 3600_000);
  return start < CORRUPT_TO && new Date() > CORRUPT_FROM;
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
  metricExpr: string,
  valueExpr: string,
  deviceIds: string[],
  range: RangeKey,
): Promise<Series[]> {
  if (deviceIds.length === 0) return [];
  const { from, bucket } = bounds(range);
  const rows = await q<Row>(
    `SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${bucket}) * ${bucket}) AS bucket,
            ${metricExpr} AS metric,
            avg(${valueExpr}) AS value,
            min(${valueExpr}) AS lo,
            max(${valueExpr}) AS hi
       FROM energy_telemetry
      WHERE "timestamp" >= ${from} AND device_id = ANY($1)
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [deviceIds],
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

export async function plantActivePowerKw(rootIds: string[]): Promise<number | null> {
  if (!rootIds.length) return null;
  const [r] = await q(
    `SELECT sum(p)/1000.0 AS kw
       FROM (SELECT DISTINCT ON (device_id) device_id, active_power AS p
               FROM energy_telemetry
              WHERE "timestamp" > now() - interval '30 seconds' AND device_id = ANY($1)
              ORDER BY device_id, "timestamp" DESC) s`,
    [rootIds],
  );
  return num(r?.kw);
}

export async function plantEnergyTodayKwh(rootIds: string[]): Promise<number | null> {
  if (!rootIds.length) return null;
  const [r] = await q(
    `SELECT sum(d)/1000.0 AS kwh
       FROM (SELECT max(active_energy) - min(active_energy) AS d
               FROM energy_telemetry
              WHERE "timestamp" >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
                                   AT TIME ZONE 'Asia/Kolkata'
                AND device_id = ANY($1)
              GROUP BY device_id) s`,
    [rootIds],
  );
  return num(r?.kwh);
}

/**
 * 15-minute load-weighted PF over the given devices. Plant PF is genuinely
 * bimodal — roughly a third of samples sit near unity, the rest at 0.87-0.92 —
 * so an instantaneous snapshot swings 0.87 to 0.99 and reads as a fault.
 */
export async function plantPowerFactor(deviceIds: string[]): Promise<number | null> {
  if (!deviceIds.length) return null;
  const [r] = await q(
    `SELECT sum(active_power) / nullif(sum(active_power / nullif(power_factor, 0)), 0) AS pf
       FROM energy_telemetry
      WHERE "timestamp" > now() - interval '15 minutes' AND device_id = ANY($1)`,
    [deviceIds],
  );
  return num(r?.pf);
}

export async function metersOnline(
  deviceIds: string[],
): Promise<{ online: number; total: number }> {
  if (!deviceIds.length) return { online: 0, total: 0 };
  const [r] = await q(
    `SELECT count(DISTINCT device_id) FILTER (WHERE "timestamp" > now() - interval '60 seconds') AS online
       FROM energy_telemetry
      WHERE "timestamp" > now() - interval '7 days' AND device_id = ANY($1)`,
    [deviceIds],
  );
  return { online: Number(r?.online ?? 0), total: deviceIds.length };
}

/** Coincident plant load: the summed instantaneous draw of the root set. */
export async function plantPowerSeries(
  rootIds: string[],
  range: RangeKey,
): Promise<Series[]> {
  if (!rootIds.length) return [];
  const { from, bucket } = bounds(range);
  const rows = await q<{ bucket: Date; kw: string; lo: string; hi: string }>(
    `SELECT bucket, sum(kw) AS kw, sum(lo) AS lo, sum(hi) AS hi FROM (
        SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${bucket}) * ${bucket}) AS bucket,
               device_id,
               avg(active_power)/1000.0 AS kw,
               min(active_power)/1000.0 AS lo,
               max(active_power)/1000.0 AS hi
          FROM energy_telemetry
         WHERE "timestamp" >= ${from} AND device_id = ANY($1)
         GROUP BY 1, 2) s
      GROUP BY bucket ORDER BY bucket`,
    [rootIds],
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

export const powerByMeter = (ids: string[], r: RangeKey) =>
  multi("device_id", "active_power/1000.0", ids, r);

/* ---- Overview and power quality ------------------------------------------ */

export const pfByMeter = (ids: string[], r: RangeKey) =>
  multi("device_id", "power_factor", ids, r);
export const voltageByMeter = (ids: string[], r: RangeKey) =>
  multi("device_id", "voltage", ids, r);
export const currentThdByMeter = (ids: string[], r: RangeKey) =>
  multi("device_id", "current_thd", ids, r);
export const voltageThdByMeter = (ids: string[], r: RangeKey) =>
  multi("device_id", "voltage_thd", ids, r);

export const voltageImbalance = (ids: string[], r: RangeKey) =>
  multi(
    "device_id",
    `(greatest(voltage_l1,voltage_l2,voltage_l3) - least(voltage_l1,voltage_l2,voltage_l3))
       / nullif((voltage_l1+voltage_l2+voltage_l3)/3.0, 0) * 100`,
    ids,
    r,
  );

export const currentImbalance = (ids: string[], r: RangeKey) =>
  multi(
    "device_id",
    `(greatest(current_l1,current_l2,current_l3) - least(current_l1,current_l2,current_l3))
       / nullif((current_l1+current_l2+current_l3)/3.0, 0) * 100`,
    ids,
    r,
  );

async function perPhase(
  cols: [string, string, string],
  range: RangeKey,
  meter: string,
): Promise<Series[]> {
  const { from, bucket } = bounds(range);
  const rows = await q<Record<string, unknown>>(
    `SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${bucket}) * ${bucket}) AS bucket,
            avg(${cols[0]}) AS l1, min(${cols[0]}) AS l1lo, max(${cols[0]}) AS l1hi,
            avg(${cols[1]}) AS l2, min(${cols[1]}) AS l2lo, max(${cols[1]}) AS l2hi,
            avg(${cols[2]}) AS l3, min(${cols[2]}) AS l3lo, max(${cols[2]}) AS l3hi
       FROM energy_telemetry
      WHERE "timestamp" >= ${from} AND device_id = $1
      GROUP BY 1 ORDER BY 1`,
    [meter],
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

export const perPhaseVoltage = (r: RangeKey, m: string) =>
  perPhase(["voltage_l1", "voltage_l2", "voltage_l3"], r, m);
export const perPhaseCurrent = (r: RangeKey, m: string) =>
  perPhase(["current_l1", "current_l2", "current_l3"], r, m);

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
  deviceIds: string[],
  range: RangeKey,
  threshold = 0.9,
): Promise<PfStat[]> {
  if (!deviceIds.length) return [];
  const { from } = bounds(range);
  const rows = await q(
    `SELECT device_id, min(power_factor) AS lo, avg(power_factor) AS mean,
            100.0 * count(*) FILTER (WHERE power_factor < $2) / nullif(count(*),0) AS pct_below
       FROM energy_telemetry
      WHERE "timestamp" >= ${from} AND device_id = ANY($1) AND power_factor IS NOT NULL
      GROUP BY device_id ORDER BY device_id`,
    [deviceIds, threshold],
  );
  return rows.map((r) => ({
    deviceId: String(r.device_id),
    min: num(r.lo),
    avg: num(r.mean),
    pctBelow: num(r.pct_below),
  }));
}

export async function meterList(): Promise<string[]> {
  const rows = await q<{ device_id: string }>(
    `SELECT DISTINCT device_id FROM energy_telemetry ORDER BY 1`,
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
  nodeId: string,
  childIds: string[],
  range: RangeKey,
): Promise<Distribution> {
  const { from } = bounds(range);
  const rows = await q(
    `SELECT device_id, (max(active_energy) - min(active_energy))/1000.0 AS kwh
       FROM energy_telemetry
      WHERE "timestamp" >= ${from} AND device_id = ANY($1)
      GROUP BY device_id`,
    [[nodeId, ...childIds]],
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
  deviceIds: string[],
  range: RangeKey,
  tariff: number,
): Promise<MeterCost[]> {
  if (!deviceIds.length) return [];
  const { from } = bounds(range);
  const rows = await q(
    `SELECT device_id,
            (max(active_energy) - min(active_energy))/1000.0 AS kwh,
            avg(power_factor) AS pf,
            (max(active_energy) - min(active_energy))/1000.0
              / nullif(avg(power_factor), 0) AS kvah
       FROM energy_telemetry
      WHERE "timestamp" >= ${from} AND device_id = ANY($1)
      GROUP BY device_id ORDER BY device_id`,
    [deviceIds],
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
  deviceIds: string[],
  range: RangeKey,
  blockMinutes = 30,
): Promise<DemandResult> {
  const empty: DemandResult = {
    coincidentKva: null,
    atBlock: null,
    blockMinutes,
    perDevice: [],
  };
  if (!deviceIds.length) return empty;

  const { from } = bounds(range);
  const secs = blockMinutes * 60;
  const blocks = `
    SELECT to_timestamp(floor(extract(epoch from "timestamp") / ${secs}) * ${secs}) AS blk,
           device_id,
           avg(active_power / nullif(power_factor, 0))/1000.0 AS kva
      FROM energy_telemetry
     WHERE "timestamp" >= ${from} AND device_id = ANY($1)
     GROUP BY 1, 2`;

  const [top] = await q(
    `SELECT blk, sum(kva) AS kva FROM (${blocks}) d
      GROUP BY blk ORDER BY sum(kva) DESC NULLS LAST LIMIT 1`,
    [deviceIds],
  );

  const per = await q(
    `SELECT DISTINCT ON (device_id) device_id, blk, kva
       FROM (${blocks}) d ORDER BY device_id, kva DESC NULLS LAST`,
    [deviceIds],
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

export const reactiveEnergyByMeter = (ids: string[], r: RangeKey) =>
  multi("device_id", "reactive_energy/1000.0", ids, r);

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
export async function deviceSnapshots(ids: string[]): Promise<DeviceSnapshot[]> {
  if (!ids.length) return [];
  const rows = await q(
    `WITH latest AS (
        SELECT DISTINCT ON (device_id) device_id, "timestamp", active_power, power_factor
          FROM energy_telemetry
         WHERE "timestamp" > now() - interval '7 days' AND device_id = ANY($1)
         ORDER BY device_id, "timestamp" DESC
     ), today AS (
        SELECT device_id,
               max(active_energy) - min(active_energy) AS wh,
               count(*) AS samples
          FROM energy_telemetry
         WHERE device_id = ANY($1)
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
    [ids],
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
