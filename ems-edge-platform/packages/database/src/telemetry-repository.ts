import type { TelemetryRecord } from "@ems/telemetry";
import type { Database } from "./client.js";

/**
 * Repository PORT. The batch writer depends on this interface, not on Prisma, so
 * the storage engine (Postgres today, Timescale/Citus/Kafka-sink later) can be
 * swapped without touching ingestion. (Repository + Dependency Inversion.)
 */
export interface TelemetryRepository {
  /** Insert a batch atomically-ish; returns the number of rows written. */
  insertMany(records: readonly TelemetryRecord[]): Promise<number>;
  /** Total row count — powers /statistics. */
  count(): Promise<number>;
}

/** Prisma-backed adapter using a single `createMany` — never row-by-row. */
export class PrismaTelemetryRepository implements TelemetryRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insertMany(records: readonly TelemetryRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const result = await this.#db.energyTelemetry.createMany({
      data: records.map((r) => ({
        deviceId: r.deviceId,
        tenantId: r.tenantId,
        plantId: r.plantId,
        timestamp: r.timestamp,
        voltage: r.voltage,
        current: r.current,
        frequency: r.frequency,
        powerFactor: r.powerFactor,
        activePower: r.activePower,
        reactivePower: r.reactivePower,
        apparentPower: r.apparentPower,
        activeEnergy: r.activeEnergy,
        reactiveEnergy: r.reactiveEnergy,
        thd: r.thd,
        quality: r.quality,
      })),
      skipDuplicates: false,
    });
    return result.count;
  }

  async count(): Promise<number> {
    return this.#db.energyTelemetry.count();
  }
}
