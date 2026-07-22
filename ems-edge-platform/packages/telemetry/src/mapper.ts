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
  | "thd"
  | "voltageL1"
  | "voltageL2"
  | "voltageL3"
  | "currentL1"
  | "currentL2"
  | "currentL3"
  | "activePowerL1"
  | "activePowerL2"
  | "activePowerL3"
  | "powerFactorL1"
  | "powerFactorL2"
  | "powerFactorL3"
  | "voltageThd"
  | "currentThd";

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
  voltage_l1: "voltageL1",
  voltage_l2: "voltageL2",
  voltage_l3: "voltageL3",
  current_l1: "currentL1",
  current_l2: "currentL2",
  current_l3: "currentL3",
  active_power_l1: "activePowerL1",
  active_power_l2: "activePowerL2",
  active_power_l3: "activePowerL3",
  power_factor_l1: "powerFactorL1",
  power_factor_l2: "powerFactorL2",
  power_factor_l3: "powerFactorL3",
  voltage_thd: "voltageThd",
  current_thd: "currentThd",
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
    voltageL1: null,
    voltageL2: null,
    voltageL3: null,
    currentL1: null,
    currentL2: null,
    currentL3: null,
    activePowerL1: null,
    activePowerL2: null,
    activePowerL3: null,
    powerFactorL1: null,
    powerFactorL2: null,
    powerFactorL3: null,
    voltageThd: null,
    currentThd: null,
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
