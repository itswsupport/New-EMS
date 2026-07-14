import type { TelemetryRecord } from "@ems/telemetry";

/**
 * Transactor — the minimal capability the poller needs from a transport: send a
 * request, get back the exact response bytes. Injecting this interface (rather
 * than a raw socket) lets us unit-test the poller against an in-memory fake.
 */
export interface Transactor {
  transact(request: Uint8Array, expectedLength: number, timeoutMs: number): Promise<Uint8Array>;
  readonly connectionId: string;
  readonly remoteAddress: string;
}

/** Where finished telemetry records go (the batch queue, in production). */
export type TelemetrySink = (record: TelemetryRecord) => Promise<void>;

/** Observability callbacks the pipeline invokes — implemented by app wiring. */
export interface PipelineHooks {
  onFrameDecoded(connectionId: string): void;
  onCrcError(connectionId: string, slave: number): void;
  onModbusException(code: number): void;
  onDecodeError(connectionId: string): void;
  onRecordProduced(connectionId: string, tenant: string, plant: string): void;
  onPollCycle(durationMs: number): void;
}
