import type { Quality } from "@ems/common";
import type { TelemetryRecord } from "./model.js";

/** One decoded register outcome for a single metric within a poll cycle. */
export interface MetricReading {
  /** Config metric key, e.g. "voltage", "active_power". */
  readonly metric: string;
  /** Decoded numeric value, or null if the read/decode failed. */
  readonly value: number | null;
}

export interface MapperIdentity {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly plantId: string;
}

/** The numeric (nullable) fields of a TelemetryRecord — the mapper's targets. */
type NumericField =
  | "voltage"
  | "current"
  | "frequency"
  | "powerFactor"
  | "activePower"
  | "reactivePower"
  | "apparentPower"
  | "activeEnergy"
  | "reactiveEnergy"
  | "thd";

/** Config metric key -> TelemetryRecord field. Central so mapping stays declarative. */
const FIELD_BY_METRIC: Record<string, NumericField> = {
  voltage: "voltage",
  current: "current",
  frequency: "frequency",
  power_factor: "powerFactor",
  active_power: "activePower",
  reactive_power: "reactivePower",
  apparent_power: "apparentPower",
  active_energy: "activeEnergy",
  reactive_energy: "reactiveEnergy",
  thd: "thd",
};

/**
 * TelemetryMapper — turns a set of per-metric readings into one domain record.
 *
 * Quality derivation (aligned with OPC-UA semantics):
 *   GOOD      — every configured metric decoded
 *   UNCERTAIN — some decoded, some failed (partial cycle)
 *   BAD       — nothing decoded this cycle
 */
export function mapReadingsToRecord(
  identity: MapperIdentity,
  readings: readonly MetricReading[],
  timestamp: Date,
): TelemetryRecord {
  // Concrete, fully-typed numeric fields (no Record indexing surprises).
  const fields: Record<NumericField, number | null> = {
    voltage: null,
    current: null,
    frequency: null,
    powerFactor: null,
    activePower: null,
    reactivePower: null,
    apparentPower: null,
    activeEnergy: null,
    reactiveEnergy: null,
    thd: null,
  };

  let good = 0;
  let known = 0; // quality is derived over KNOWN metrics only; unknown keys ignored
  for (const r of readings) {
    const field = FIELD_BY_METRIC[r.metric];
    if (!field) continue; // unknown metric key — ignore; config drives schema
    fields[field] = r.value;
    known++;
    if (r.value !== null) good++;
  }

  const quality: Quality = deriveQuality(good, known);

  return {
    deviceId: identity.deviceId,
    tenantId: identity.tenantId,
    plantId: identity.plantId,
    timestamp,
    ...fields,
    quality,
  };
}

function deriveQuality(good: number, total: number): Quality {
  if (good === 0) return "BAD";
  if (good === total) return "GOOD";
  return "UNCERTAIN";
}
