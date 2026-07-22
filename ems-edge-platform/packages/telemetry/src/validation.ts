import { z } from "zod";
import { ValidationError, type Result, type Quality, ok, err } from "@ems/common";
import type { TelemetryRecord } from "./model.js";

/**
 * Physical plausibility bounds. These are NOT security validation (that happens
 * at the transport edge) — they catch decode/wiring faults (e.g. wrong byte order
 * producing 1e38 V). Out-of-range readings are not dropped; they are marked
 * quality=BAD so downstream analytics can decide, satisfying "no data loss".
 */
const nullableInRange = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable();

export const telemetryBoundsSchema = z.object({
  voltage: nullableInRange(0, 1000),
  current: nullableInRange(0, 10_000),
  frequency: nullableInRange(0, 100),
  powerFactor: nullableInRange(-1, 1),
  activePower: nullableInRange(-2_000_000, 2_000_000),
  reactivePower: nullableInRange(-2_000_000, 2_000_000),
  apparentPower: nullableInRange(0, 2_000_000),
  activeEnergy: nullableInRange(0, 1e12),
  reactiveEnergy: nullableInRange(0, 1e12),
  thd: nullableInRange(0, 100),

  // Per-phase (same physical bounds as their aggregate counterparts)
  voltageL1: nullableInRange(0, 1000),
  voltageL2: nullableInRange(0, 1000),
  voltageL3: nullableInRange(0, 1000),
  currentL1: nullableInRange(0, 10_000),
  currentL2: nullableInRange(0, 10_000),
  currentL3: nullableInRange(0, 10_000),
  activePowerL1: nullableInRange(-2_000_000, 2_000_000),
  activePowerL2: nullableInRange(-2_000_000, 2_000_000),
  activePowerL3: nullableInRange(-2_000_000, 2_000_000),
  powerFactorL1: nullableInRange(-1, 1),
  powerFactorL2: nullableInRange(-1, 1),
  powerFactorL3: nullableInRange(-1, 1),
  voltageThd: nullableInRange(0, 100),
  currentThd: nullableInRange(0, 100),
  maximumDemand: nullableInRange(0, 2_000_000),
});

/**
 * Validate a record's electrical fields. Returns the record with a possibly
 * DOWNGRADED quality — never throws for out-of-range data (that would lose it).
 * Structural problems (e.g. missing identity) DO fail hard.
 */
export function validateTelemetry(
  record: TelemetryRecord,
): Result<TelemetryRecord, ValidationError> {
  if (!record.deviceId || !record.tenantId || !record.plantId) {
    return err(new ValidationError("missing identity fields", { deviceId: record.deviceId }));
  }

  const parsed = telemetryBoundsSchema.safeParse(record);
  if (parsed.success) return ok(record);

  // Physically implausible → keep the sample but mark it BAD for triage.
  const downgraded: Quality = record.quality === "GOOD" ? "BAD" : record.quality;
  return ok({ ...record, quality: downgraded });
}
