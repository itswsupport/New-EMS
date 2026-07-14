import type { WriterObserver } from "@ems/database";
import type { PipelineHooks } from "@ems/gateway-listener";
import type { Metrics, StatsStore } from "@ems/observability";

/**
 * Adapters that translate raw pipeline events into metrics + stats updates. Kept
 * here (composition layer) so the domain packages never depend on prom-client or
 * on each other for observability.
 */
export function buildPipelineHooks(metrics: Metrics, stats: StatsStore): PipelineHooks {
  return {
    onFrameDecoded(connectionId) {
      metrics.framesDecoded.inc();
      stats.recordFrame(connectionId);
    },
    onCrcError(_connectionId, _slave) {
      metrics.crcErrors.inc();
      stats.recordCrcError();
    },
    onModbusException(code) {
      metrics.modbusExceptions.inc({ code: String(code) });
    },
    onDecodeError(_connectionId) {
      metrics.decodeErrors.inc();
      stats.recordDecodeError();
    },
    onRecordProduced(connectionId, tenant, plant) {
      metrics.recordsIngested.inc({ tenant, plant });
      stats.recordProduced(connectionId);
    },
    onPollCycle(durationMs) {
      metrics.pollDuration.observe(durationMs / 1000);
    },
  };
}

export function buildWriterObserver(metrics: Metrics, stats: StatsStore): WriterObserver {
  return {
    onBatchWritten(rows, durationMs) {
      metrics.recordsPersisted.inc(rows);
      metrics.batchFlushDuration.observe(durationMs / 1000);
      stats.recordPersisted(rows);
    },
    onRetry() {
      metrics.dbRetries.inc();
    },
    onDeadLetter(rows) {
      metrics.deadLettered.inc(rows);
      stats.recordDeadLetter(rows);
    },
  };
}
