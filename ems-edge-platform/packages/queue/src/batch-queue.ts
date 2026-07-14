/**
 * BatchQueue<T> — the port (interface) the ingestion pipeline depends on.
 *
 * The pipeline never knows whether batches are held in memory, Redis, NATS, or
 * Kafka. Today we ship an in-memory adapter; migrating to Kafka is writing a new
 * class that implements this interface and swapping it in the composition root —
 * zero pipeline changes. (Hexagonal / Dependency Inversion.)
 */
export interface BatchQueue<T> {
  /** Enqueue one item. May trigger a size-based flush. */
  enqueue(item: T): Promise<void>;

  /** Force-flush whatever is buffered (used on shutdown). */
  flush(): Promise<void>;

  /** Current buffered depth — surfaced via /statistics and metrics. */
  size(): number;

  /** Stop timers and flush. Idempotent. */
  close(): Promise<void>;
}

/** Called with each batch. MUST NOT throw for retryable errors — it owns retries. */
export type FlushHandler<T> = (batch: readonly T[]) => Promise<void>;

export interface BatchQueueOptions {
  /** Flush when this many items are buffered. */
  readonly maxBatchSize: number;
  /** Flush at most this many ms after the first item of a batch arrives. */
  readonly flushIntervalMs: number;
  /** Hard cap on buffered items; enqueue applies back-pressure beyond this. */
  readonly maxBufferedItems?: number;
}
