import { createServer, type Server, type Socket } from "node:net";
import { newConnectionId } from "@ems/common";
import type { ResolvedDevice } from "@ems/config";
import { withIdentity, type Logger } from "@ems/logger";
import { createModbusCodec, type ModbusFraming } from "@ems/modbus";
import { Connection } from "./connection.js";
import { DevicePoller, type PollerOptions } from "./poller.js";
import { ConnectionRateLimiter } from "./rate-limiter.js";
import type { PipelineHooks, TelemetrySink } from "./types.js";

export interface GatewayServerOptions extends PollerOptions {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  readonly rateLimitPerMin: number;
  /** Modbus wire framing: "tcp" (MBAP, gateway converts) or "rtu" (transparent). */
  readonly framing: ModbusFraming;
}

export interface GatewayServerDeps {
  readonly devices: readonly ResolvedDevice[];
  readonly sink: TelemetrySink;
  readonly hooks: PipelineHooks;
  readonly log: Logger;
  readonly onOpen: (connectionId: string, remoteAddress: string) => void;
  readonly onClose: (connectionId: string, reason: string) => void;
}

/**
 * GatewayServer — TCP LISTENER (the X5050 is a TCP client and dials us).
 *
 * Transport concerns ONLY: accept/limit/timeout sockets, wrap each in a
 * Connection + DevicePoller, and clean up on close. It knows nothing about
 * Modbus internals or persistence — those live behind the injected ports.
 */
export class GatewayServer {
  #server: Server | null = null;
  readonly #pollers = new Map<string, { conn: Connection; poller: DevicePoller }>();
  readonly #limiter: ConnectionRateLimiter;

  constructor(
    private readonly opts: GatewayServerOptions,
    private readonly deps: GatewayServerDeps,
  ) {
    this.#limiter = new ConnectionRateLimiter(opts.rateLimitPerMin);
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.#onConnection(socket));
      server.maxConnections = this.opts.maxConnections;
      server.on("error", reject);
      server.listen(this.opts.port, this.opts.host, () => {
        this.deps.log.info(
          { host: this.opts.host, port: this.opts.port, max: this.opts.maxConnections },
          "gateway TCP listener started",
        );
        resolve();
      });
      this.#server = server;
    });
  }

  #onConnection(socket: Socket): void {
    const ip = socket.remoteAddress ?? "unknown";
    if (!this.#limiter.allow(ip, Date.now())) {
      this.deps.log.warn({ ip }, "connection rejected: rate limit");
      socket.destroy();
      return;
    }

    const connectionId = newConnectionId();
    const connLog = withIdentity(this.deps.log, { connection_id: connectionId });
    socket.setNoDelay(true);
    socket.setTimeout(this.opts.connectionTimeoutMs);
    socket.on("timeout", () => {
      connLog.warn("connection idle timeout");
      this.#teardown(connectionId, "timeout");
    });

    const conn = new Connection(socket, connectionId, connLog);
    // One codec per connection — the TCP codec holds a transaction counter.
    const poller = new DevicePoller(
      conn,
      createModbusCodec(this.opts.framing),
      this.deps.devices,
      this.deps.sink,
      this.deps.hooks,
      connLog,
      this.opts,
    );

    this.#pollers.set(connectionId, { conn, poller });
    this.deps.onOpen(connectionId, conn.remoteAddress);
    connLog.info({ remote: conn.remoteAddress }, "connection accepted");

    socket.on("close", () => this.#teardown(connectionId, "closed"));
    socket.on("error", (err) => connLog.warn({ reason: err.message }, "socket error"));

    poller.start();
  }

  #teardown(connectionId: string, reason: string): void {
    const entry = this.#pollers.get(connectionId);
    if (!entry) return;
    entry.poller.stop();
    entry.conn.destroy();
    this.#pollers.delete(connectionId);
    this.deps.onClose(connectionId, reason);
    this.deps.log.info({ connection_id: connectionId, reason }, "connection closed");
  }

  activeConnections(): number {
    return this.#pollers.size;
  }

  async close(): Promise<void> {
    for (const [id] of this.#pollers) this.#teardown(id, "shutdown");
    await new Promise<void>((resolve) => {
      if (!this.#server) return resolve();
      this.#server.close(() => resolve());
    });
  }
}
