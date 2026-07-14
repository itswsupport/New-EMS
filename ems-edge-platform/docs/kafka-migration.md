# Future: Migrating the Queue to Kafka (or NATS / Redis Streams)

The batch queue is a **port**, so moving off the in-memory adapter touches ZERO
pipeline code — only the composition root and one new adapter class.

## The seam

```ts
// packages/queue/src/batch-queue.ts
export interface BatchQueue<T> {
  enqueue(item: T): Promise<void>;
  flush(): Promise<void>;
  size(): number;
  close(): Promise<void>;
}
```
`DevicePoller` calls `sink(record)` → `queue.enqueue(record)`. `DatabaseWriter` is
the `FlushHandler`. Neither knows the queue's implementation.

## Target architecture

```
Poller ──enqueue──► KafkaBatchQueue ──produce──► Kafka topic: ems.telemetry.<tenant>
                                                        │
                              ┌─────────────────────────┼───────────────────────┐
                              ▼                          ▼                        ▼
                     DB sink consumer          Timescale/lake consumer     analytics/AI
                     (createMany)               (bulk COPY)                 (stream proc)
```

Ingestion (edge) and persistence (consumer) become separate deployables — a crash
no longer risks the in-flight buffer, and multiple consumers fan out.

## Steps

1. **Add adapter** `packages/queue/src/kafka-batch-queue.ts` implementing
   `BatchQueue<TelemetryRecord>` with a KafkaJS producer; partition key =
   `tenantId:deviceId` for ordering per meter.
2. **New consumer app** `apps/telemetry-consumer` that reads the topic, batches,
   and reuses the existing `DatabaseWriter` unchanged.
3. **Swap in the composition root** (`app.ts`): construct `KafkaBatchQueue`
   instead of `InMemoryBatchQueue`. The `sink` closure is identical.
4. **Delivery semantics** — enable idempotent producer + consumer offsets; make
   `insertMany` idempotent (natural key `device_id,timestamp` UNIQUE +
   `ON CONFLICT DO NOTHING`) for effectively-exactly-once.
5. **Ops** — add Kafka to compose/K8s; export consumer lag to Prometheus.

## Why it stays cheap
- No changes to `modbus`, `telemetry`, `gateway-listener`, or `database` writer.
- Same metrics/stats hooks.
- Same dead-letter safety net on the consumer side.
- The interface already models `close()`/back-pressure, matching broker flush.
