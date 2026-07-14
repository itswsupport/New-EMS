import type { Socket } from "node:net";
import { TimeoutError, type ConnectionId } from "@ems/common";
import { FrameDecoder } from "@ems/modbus";
import type { Logger } from "@ems/logger";
import type { Transactor } from "./types.js";

interface Pending {
  expectedLength: number;
  resolve: (frame: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Connection — owns one accepted gateway socket and turns the raw byte stream
 * into request/response TRANSACTIONS.
 *
 * The X5050 relays to a single RS-485 bus, so only ONE transaction may be in
 * flight at a time; the poller awaits each `transact()` before issuing the next.
 * Incoming bytes feed a FrameDecoder that releases a frame once the expected
 * length has arrived (RTU has no length prefix — we frame by expectation).
 */
export class Connection implements Transactor {
  readonly connectionId: string;
  readonly remoteAddress: string;
  readonly #socket: Socket;
  readonly #log: Logger;
  readonly #decoder = new FrameDecoder();
  #pending: Pending | null = null;
  #destroyed = false;

  constructor(socket: Socket, connectionId: ConnectionId, log: Logger) {
    this.#socket = socket;
    this.connectionId = connectionId;
    this.remoteAddress = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`;
    this.#log = log;
    this.#log.debug({ remote: this.remoteAddress }, "connection wrapper initialised");

    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (err) => this.#failPending(err));
    socket.on("close", () => this.#failPending(new Error("connection closed")));
  }

  transact(request: Uint8Array, expectedLength: number, timeoutMs: number): Promise<Uint8Array> {
    if (this.#destroyed) return Promise.reject(new Error("connection destroyed"));
    if (this.#pending) {
      return Promise.reject(new Error("transaction already in flight (bus is serial)"));
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = null;
        this.#decoder.reset(); // drop partial bytes to resync the bus
        reject(new TimeoutError("modbus response timed out", { expectedLength, timeoutMs }));
      }, timeoutMs);
      timer.unref?.();

      this.#pending = { expectedLength, resolve, reject, timer };
      this.#socket.write(request, (err) => {
        if (err) this.#failPending(err);
      });
    });
  }

  #onData(chunk: Buffer): void {
    this.#decoder.push(chunk);
    const p = this.#pending;
    if (!p) return; // unsolicited data (or between transactions) — buffered/ignored
    const frame = this.#decoder.takeFrame(p.expectedLength);
    if (!frame) return; // still waiting for the rest of the frame
    clearTimeout(p.timer);
    this.#pending = null;
    p.resolve(frame);
  }

  #failPending(err: Error): void {
    const p = this.#pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.#pending = null;
    p.reject(err);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#failPending(new Error("connection destroyed"));
    this.#socket.destroy();
  }
}
