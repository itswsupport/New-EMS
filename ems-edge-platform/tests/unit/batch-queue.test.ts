import { describe, it, expect, vi } from "vitest";
import { InMemoryBatchQueue } from "@ems/queue";

describe("InMemoryBatchQueue", () => {
  it("flushes when maxBatchSize is reached", async () => {
    const flushed: number[][] = [];
    const q = new InMemoryBatchQueue<number>(
      async (batch) => void flushed.push([...batch]),
      { maxBatchSize: 3, flushIntervalMs: 10_000 },
    );
    await q.enqueue(1);
    await q.enqueue(2);
    expect(flushed).toHaveLength(0);
    await q.enqueue(3); // hits size threshold
    expect(flushed).toEqual([[1, 2, 3]]);
    await q.close();
  });

  it("flushes on the time interval", async () => {
    vi.useFakeTimers();
    const flushed: number[][] = [];
    const q = new InMemoryBatchQueue<number>(
      async (batch) => void flushed.push([...batch]),
      { maxBatchSize: 100, flushIntervalMs: 2000 },
    );
    await q.enqueue(42);
    await vi.advanceTimersByTimeAsync(2000);
    expect(flushed).toEqual([[42]]);
    await q.close();
    vi.useRealTimers();
  });

  it("close() flushes remaining buffered items (no data loss)", async () => {
    const flushed: number[][] = [];
    const q = new InMemoryBatchQueue<number>(
      async (batch) => void flushed.push([...batch]),
      { maxBatchSize: 100, flushIntervalMs: 100_000 },
    );
    await q.enqueue(7);
    await q.enqueue(8);
    await q.close();
    expect(flushed).toEqual([[7, 8]]);
  });

  it("does not overlap flush handlers", async () => {
    let active = 0;
    let maxActive = 0;
    const q = new InMemoryBatchQueue<number>(
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      { maxBatchSize: 1, flushIntervalMs: 10_000 },
    );
    await Promise.all([q.enqueue(1), q.enqueue(2), q.enqueue(3)]);
    await q.close();
    expect(maxActive).toBe(1);
  });
});
