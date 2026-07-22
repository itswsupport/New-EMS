import type { Quality } from "@ems/common";

/**
 * TelemetryRecord — the canonical domain entity written to `energy_telemetry`.
 * Electrical fields are nullable: a meter/register map may not expose every
 * parameter, and a failed read yields null + degraded quality rather than a gap.
 *
 * This is a pure data shape (no behaviour) shared by mapper, validator, queue,
 * and repository — the "ubiquitous language" object of the ingestion domain.
 */
export interface TelemetryRecord {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly plantId: string;
  /** Sample time (when the poll cycle completed), UTC. */
  readonly timestamp: Date;

  readonly voltage: number | null;
  readonly current: number | null;
  readonly frequency: number | null;
  readonly powerFactor: number | null;
  readonly activePower: number | null;
  readonly reactivePower: number | null;
  readonly apparentPower: number | null;
  readonly activeEnergy: number | null;
  readonly reactiveEnergy: number | null;
  readonly thd: number | null;

  // --- Per-phase (STEP 2): imbalance detection + per-machine breakdown ---
  readonly voltageL1: number | null;
  readonly voltageL2: number | null;
  readonly voltageL3: number | null;
  readonly currentL1: number | null;
  readonly currentL2: number | null;
  readonly currentL3: number | null;
  readonly activePowerL1: number | null;
  readonly activePowerL2: number | null;
  readonly activePowerL3: number | null;
  readonly powerFactorL1: number | null;
  readonly powerFactorL2: number | null;
  readonly powerFactorL3: number | null;

  // --- Power quality: harmonic distortion (top predictive-maintenance signal) ---
  readonly voltageThd: number | null;
  readonly currentThd: number | null;

  readonly quality: Quality;
}

/** The set of metric keys the mapper knows how to place onto a TelemetryRecord. */
export const TELEMETRY_METRIC_KEYS = [
  "voltage",
  "current",
  "frequency",
  "power_factor",
  "active_power",
  "reactive_power",
  "apparent_power",
  "active_energy",
  "reactive_energy",
  "thd",
  "voltage_l1",
  "voltage_l2",
  "voltage_l3",
  "current_l1",
  "current_l2",
  "current_l3",
  "active_power_l1",
  "active_power_l2",
  "active_power_l3",
  "power_factor_l1",
  "power_factor_l2",
  "power_factor_l3",
  "voltage_thd",
  "current_thd",
] as const;

export type TelemetryMetricKey = (typeof TELEMETRY_METRIC_KEYS)[number];
