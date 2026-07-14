# Sequence Diagrams

## 1. Gateway connection + poll cycle

```mermaid
sequenceDiagram
    participant GW as X5050 (TCP client)
    participant SRV as GatewayServer
    participant CON as Connection
    participant POL as DevicePoller
    participant DEC as Modbus (codec/decoder)
    participant Q as BatchQueue
    participant W as DatabaseWriter
    participant DB as PostgreSQL

    GW->>SRV: TCP connect :4196
    SRV->>SRV: rate-limit + maxConnections check
    SRV->>CON: new Connection(socket)
    SRV->>POL: new DevicePoller(...); start()

    loop every POLL_INTERVAL_MS, per device, per register
        POL->>CON: transact(FC03 request, expectedLen, timeout)
        CON->>GW: write RTU request
        GW-->>CON: RTU response bytes (may be chunked)
        CON->>CON: FrameDecoder.takeFrame(expectedLen)
        CON-->>POL: complete frame
        POL->>DEC: parseReadResponse (CRC, exception checks)
        POL->>DEC: decodeRegisters (float32, byteOrder)
    end
    POL->>POL: mapReadingsToRecord + validate (quality)
    POL->>Q: enqueue(TelemetryRecord)

    alt buffer >= 500 OR 2s elapsed
        Q->>W: flush(batch)
        W->>DB: createMany(batch)
        DB-->>W: rows written
        W-->>Q: ok (metrics + info log: rows, batch_ms, rows_per_sec)
    end
```

## 2. Failure & durability paths

```mermaid
sequenceDiagram
    participant POL as DevicePoller
    participant CON as Connection
    participant W as DatabaseWriter
    participant DL as Dead-letter file

    Note over POL,CON: CRC error / Modbus exception
    CON-->>POL: frame
    POL->>POL: parse → CrcError → retry (<= MODBUS_MAX_RETRIES)
    alt still failing
        POL->>POL: reading = null → quality UNCERTAIN/BAD (record kept)
    end

    Note over W,DL: DB unavailable
    W->>W: insertMany throws → backoff (exp + jitter)
    loop up to DB_MAX_RETRIES
        W->>W: retry
    end
    alt retries exhausted
        W->>DL: append NDJSON batch (no data loss)
    end
```

## 3. Graceful shutdown (SIGTERM)

```mermaid
sequenceDiagram
    participant K8s as Docker/K8s
    participant M as main.ts
    participant APP as App (composition root)

    K8s->>M: SIGTERM
    M->>M: arm hard-timeout (SHUTDOWN_TIMEOUT_MS)
    M->>APP: stop()
    APP->>APP: gateway.close()  (stop accept + polling)
    APP->>APP: queue.close()    (flush buffered records)
    APP->>APP: db.$disconnect()
    APP->>APP: api.close()
    APP-->>M: done → exit(0)
    Note over M: if anything hangs, hard-timeout forces exit(1)
```
