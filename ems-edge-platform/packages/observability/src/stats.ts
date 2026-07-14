/**
 * StatsStore — lightweight in-process rollups for the /statistics and
 * /connections endpoints (human-facing snapshots, distinct from Prometheus
 * time-series). No external deps; cheap to update on the hot path.
 */
export interface ConnectionSnapshot {
  readonly connectionId: string;
  readonly remoteAddress: string;
  readonly connectedAt: string;
  readonly framesDecoded: number;
  readonly recordsProduced: number;
  readonly lastActivityAt: string;
}

export interface StatisticsSnapshot {
  readonly uptimeSeconds: number;
  readonly activeConnections: number;
  readonly totalConnectionsAccepted: number;
  readonly recordsIngested: number;
  readonly recordsPersisted: number;
  readonly crcErrors: number;
  readonly decodeErrors: number;
  readonly deadLettered: number;
  readonly queueDepth: number;
  readonly recordsPerSecond: number;
}

export class StatsStore {
  readonly #startedAt = Date.now();
  readonly #connections = new Map<string, MutableConn>();
  #totalAccepted = 0;
  #recordsIngested = 0;
  #recordsPersisted = 0;
  #crcErrors = 0;
  #decodeErrors = 0;
  #deadLettered = 0;
  #queueDepthFn: () => number = () => 0;

  bindQueueDepth(fn: () => number): void {
    this.#queueDepthFn = fn;
  }

  connectionOpened(connectionId: string, remoteAddress: string): void {
    this.#totalAccepted++;
    this.#connections.set(connectionId, {
      connectionId,
      remoteAddress,
      connectedAt: Date.now(),
      framesDecoded: 0,
      recordsProduced: 0,
      lastActivityAt: Date.now(),
    });
  }

  connectionClosed(connectionId: string): void {
    this.#connections.delete(connectionId);
  }

  recordFrame(connectionId: string): void {
    const conn = this.#connections.get(connectionId);
    if (conn) {
      conn.framesDecoded++;
      conn.lastActivityAt = Date.now();
    }
  }

  recordProduced(connectionId: string, n = 1): void {
    this.#recordsIngested += n;
    const conn = this.#connections.get(connectionId);
    if (conn) conn.recordsProduced += n;
  }

  recordPersisted(n: number): void {
    this.#recordsPersisted += n;
  }
  recordCrcError(): void {
    this.#crcErrors++;
  }
  recordDecodeError(): void {
    this.#decodeErrors++;
  }
  recordDeadLetter(n: number): void {
    this.#deadLettered += n;
  }

  listConnections(): ConnectionSnapshot[] {
    return [...this.#connections.values()].map((c) => ({
      connectionId: c.connectionId,
      remoteAddress: c.remoteAddress,
      connectedAt: new Date(c.connectedAt).toISOString(),
      framesDecoded: c.framesDecoded,
      recordsProduced: c.recordsProduced,
      lastActivityAt: new Date(c.lastActivityAt).toISOString(),
    }));
  }

  snapshot(): StatisticsSnapshot {
    const uptimeSeconds = Math.max(1, Math.round((Date.now() - this.#startedAt) / 1000));
    return {
      uptimeSeconds,
      activeConnections: this.#connections.size,
      totalConnectionsAccepted: this.#totalAccepted,
      recordsIngested: this.#recordsIngested,
      recordsPersisted: this.#recordsPersisted,
      crcErrors: this.#crcErrors,
      decodeErrors: this.#decodeErrors,
      deadLettered: this.#deadLettered,
      queueDepth: this.#queueDepthFn(),
      recordsPerSecond: Math.round(this.#recordsIngested / uptimeSeconds),
    };
  }
}

interface MutableConn {
  connectionId: string;
  remoteAddress: string;
  connectedAt: number;
  framesDecoded: number;
  recordsProduced: number;
  lastActivityAt: number;
}
