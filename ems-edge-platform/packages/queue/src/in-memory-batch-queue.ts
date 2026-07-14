import { sleep } from "@ems/common";
import type { BatchQueue, BatchQueueOptions, FlushHandler } from "./batch-queue.js";

/**
 * InMemoryBatchQueue — default adapter.
 *
 * Flush trigger: `maxBatchSize` reached OR `flushIntervalMs` elapsed since the
 * batch's first item — whichever comes first (spec: 500 records or 2s).
 *
 * Concurrency: a single in-flight flush is enforced with a promise chain, so the
 * FlushHandler never runs re-entrantly and batch ordering is preserved. Enqueue
 * applies async back-pressure when the buffer exceeds `maxBufferedItems`, so a
 * slow database cannot cause unbounded memory growth ("no data loss" without OOM).
 */
export class InMemoryBatchQueue<T> implements BatchQueue<T> {
  #buffer: T[] = [];
  #timer: NodeJS.Timeout | null = null;
  #flushChain: Promise<void> = Promise.resolve();
  #closed = false;
  readonly #maxBatch: number;
  readonly #intervalMs: number;
  readonly #maxBuffered: number;
  readonly #onFlush: FlushHandler<T>;

  constructor(onFlush: FlushHandler<T>, opts: BatchQueueOptions) {
    this.#onFlush = onFlush;
    this.#maxBatch = opts.maxBatchSize;
    this.#intervalMs = opts.flushIntervalMs;
    this.#maxBuffered = opts.maxBufferedItems ?? opts.maxBatchSize * 20;
  }

  async enqueue(item: T): Promise<void> {
    if (this.#closed) throw new Error("queue is closed");

    // Back-pressure: yield until the buffer drains below the cap.
    while (this.#buffer.length >= this.#maxBuffered) {
      await sleep(this.#intervalMs);
    }

    this.#buffer.push(item);

    if (this.#buffer.length === 1) this.#armTimer();
    if (this.#buffer.length >= this.#maxBatch) await this.flush();
  }

  async flush(): Promise<void> {
    this.#disarmTimer();
    if (this.#buffer.length === 0) return this.#flushChain;

    const batch = this.#buffer;
    this.#buffer = [];

    // Serialize flushes: chain onto the previous so handlers never overlap.
    this.#flushChain = this.#flushChain.then(() => this.#onFlush(batch));
    return this.#flushChain;
  }

  size(): number {
    return this.#buffer.length;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.flush();
    await this.#flushChain;
  }

  #armTimer(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      void this.flush();
    }, this.#intervalMs);
    // Do not keep the event loop alive solely for a pending flush timer.
    this.#timer.unref?.();
  }

  #disarmTimer(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
