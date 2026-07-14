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
] as const;

export type TelemetryMetricKey = (typeof TELEMETRY_METRIC_KEYS)[number];
