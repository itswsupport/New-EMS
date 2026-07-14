import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Metrics registry. One instance per process, injected where needed. Kept in its
 * own package so both the gateway pipeline and the HTTP API depend on the SAME
 * registry without importing each other (avoids an app<->app cycle).
 *
 * Naming follows Prometheus conventions: base unit suffixes, _total for counters.
 */
export class Metrics {
  readonly registry: Registry;

  readonly connectionsAccepted: Counter<string>;
  readonly connectionsClosed: Counter<string>;
  readonly activeConnections: Gauge<string>;
  readonly framesDecoded: Counter<string>;
  readonly crcErrors: Counter<string>;
  readonly modbusExceptions: Counter<string>;
  readonly decodeErrors: Counter<string>;
  readonly recordsIngested: Counter<string>;
  readonly recordsPersisted: Counter<string>;
  readonly dbRetries: Counter<string>;
  readonly deadLettered: Counter<string>;
  readonly batchFlushDuration: Histogram<string>;
  readonly pollDuration: Histogram<string>;
  readonly queueDepth: Gauge<string>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: "ems-edge-platform" });
    collectDefaultMetrics({ register: this.registry }); // process/heap/eventloop

    const c = (name: string, help: string, labelNames: string[] = []) =>
      new Counter({ name, help, labelNames, registers: [this.registry] });
    const g = (name: string, help: string, labelNames: string[] = []) =>
      new Gauge({ name, help, labelNames, registers: [this.registry] });

    this.connectionsAccepted = c("ems_connections_accepted_total", "Gateway connections accepted");
    this.connectionsClosed = c("ems_connections_closed_total", "Gateway connections closed", ["reason"]);
    this.activeConnections = g("ems_active_connections", "Currently open gateway connections");
    this.framesDecoded = c("ems_frames_decoded_total", "Modbus frames successfully decoded");
    this.crcErrors = c("ems_crc_errors_total", "RTU frames failing CRC");
    this.modbusExceptions = c("ems_modbus_exceptions_total", "Modbus exception responses", ["code"]);
    this.decodeErrors = c("ems_register_decode_errors_total", "Register decode failures");
    this.recordsIngested = c("ems_records_ingested_total", "Telemetry records mapped", ["tenant", "plant"]);
    this.recordsPersisted = c("ems_records_persisted_total", "Telemetry rows written to DB");
    this.dbRetries = c("ems_db_retries_total", "DB insert retry attempts");
    this.deadLettered = c("ems_dead_lettered_total", "Records written to dead-letter file");
    this.queueDepth = g("ems_queue_depth", "Batch queue buffered depth");

    this.batchFlushDuration = new Histogram({
      name: "ems_batch_flush_duration_seconds",
      help: "DB batch flush duration",
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.pollDuration = new Histogram({
      name: "ems_poll_cycle_duration_seconds",
      help: "Per-device poll cycle duration",
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5],
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
