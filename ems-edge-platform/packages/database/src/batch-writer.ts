import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backoffDelay, sleep, type Result, ok, err } from "@ems/common";
import type { Logger } from "@ems/logger";
import type { TelemetryRecord } from "@ems/telemetry";
import type { TelemetryRepository } from "./telemetry-repository.js";

export interface BatchWriterOptions {
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  /** File where a batch that exhausts all retries is persisted (never dropped). */
  readonly deadLetterPath: string;
}

/** Metrics hooks — injected so this package stays free of prom-client. */
export interface WriterObserver {
  onBatchWritten(rows: number, durationMs: number): void;
  onRetry(attempt: number): void;
  onDeadLetter(rows: number): void;
}

const NOOP_OBSERVER: WriterObserver = {
  onBatchWritten: () => {},
  onRetry: () => {},
  onDeadLetter: () => {},
};

/**
 * DatabaseWriter — durable batch persistence.
 *
 * Guarantees:
 *  • BATCHED: one createMany per flush, never per-row.
 *  • RETRIED: transient DB errors retried with exponential backoff + jitter.
 *  • NO DATA LOSS: a batch that exhausts retries is written to a dead-letter
 *    file (append-only NDJSON) for later replay — it is never silently dropped.
 *
 * Its `flushHandler` is handed to the BatchQueue; the queue owns timing, this
 * owns durability. Clean separation of "when to flush" vs "how to persist".
 */
export class DatabaseWriter {
  readonly #repo: TelemetryRepository;
  readonly #log: Logger;
  readonly #opts: BatchWriterOptions;
  readonly #obs: WriterObserver;

  constructor(
    repo: TelemetryRepository,
    log: Logger,
    opts: BatchWriterOptions,
    observer: WriterObserver = NOOP_OBSERVER,
  ) {
    this.#repo = repo;
    this.#log = log;
    this.#opts = opts;
    this.#obs = observer;
  }

  /** FlushHandler<TelemetryRecord> — bound method safe to pass to the queue. */
  readonly flushHandler = async (batch: readonly TelemetryRecord[]): Promise<void> => {
    if (batch.length === 0) return;
    const result = await this.#writeWithRetry(batch);
    if (!result.ok) {
      this.#deadLetter(batch, result.error);
    }
  };

  async #writeWithRetry(
    batch: readonly TelemetryRecord[],
  ): Promise<Result<number, Error>> {
    for (let attempt = 0; attempt <= this.#opts.maxRetries; attempt++) {
      const started = performance.now();
      try {
        const rows = await this.#repo.insertMany(batch);
        const durationMs = performance.now() - started;
        this.#obs.onBatchWritten(rows, durationMs);
        // Per-batch at info (spec); per-record detail only at debug.
        this.#log.info(
          { rows, batch_ms: Math.round(durationMs), rows_per_sec: rate(rows, durationMs) },
          "batch persisted",
        );
        if (this.#log.isLevelEnabled("debug")) {
          this.#log.debug({ sample: batch[0] }, "batch sample record");
        }
        return ok(rows);
      } catch (cause) {
        const errorObj = cause as Error;
        if (attempt === this.#opts.maxRetries) return err(errorObj);
        this.#obs.onRetry(attempt + 1);
        const delay = backoffDelay(attempt, this.#opts.retryBackoffMs);
        this.#log.warn(
          { attempt: attempt + 1, delay_ms: delay, reason: errorObj.message },
          "batch insert failed; backing off",
        );
        await sleep(delay);
      }
    }
    return err(new Error("unreachable"));
  }

  #deadLetter(batch: readonly TelemetryRecord[], cause: Error): void {
    this.#obs.onDeadLetter(batch.length);
    this.#log.error(
      { rows: batch.length, reason: cause.message, path: this.#opts.deadLetterPath },
      "batch dead-lettered after exhausting retries",
    );
    try {
      mkdirSync(dirname(this.#opts.deadLetterPath), { recursive: true });
      const lines = batch.map((r) => JSON.stringify(r)).join("\n") + "\n";
      appendFileSync(this.#opts.deadLetterPath, lines, "utf8");
    } catch (writeErr) {
      // Last-resort: if even the dead-letter write fails, log loudly so the
      // records exist in the log stream (still not silently lost).
      this.#log.fatal(
        { reason: (writeErr as Error).message, rows: batch.length },
        "DEAD-LETTER WRITE FAILED — records only in log stream",
      );
      for (const r of batch) this.#log.fatal({ record: r }, "unpersisted record");
    }
  }
}

function rate(rows: number, durationMs: number): number {
  return durationMs <= 0 ? rows : Math.round((rows / durationMs) * 1000);
}
