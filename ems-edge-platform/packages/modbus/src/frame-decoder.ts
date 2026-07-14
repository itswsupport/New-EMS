/**
 * FrameDecoder — the boundary between the raw TCP byte stream and Modbus parsing.
 *
 * TCP is a stream: a single meter response may arrive split across packets, or
 * several responses may be coalesced. RTU has no length prefix, so as the master
 * we frame by EXPECTED length: the poller tells us how many bytes the in-flight
 * transaction will return; we buffer until we have them, emit that frame, and
 * keep any leftover bytes for the next transaction.
 *
 * This class holds only bytes + an integer — no transport, no parsing — so it is
 * deterministic and unit-testable by feeding arbitrary chunk boundaries.
 */
export class FrameDecoder {
  #buffer: Uint8Array = new Uint8Array(0);

  /** Append newly-received bytes to the internal buffer. */
  push(chunk: Uint8Array): void {
    if (this.#buffer.length === 0) {
      this.#buffer = Uint8Array.from(chunk);
      return;
    }
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;
  }

  /**
   * Try to take exactly `expectedLength` bytes as one frame. Returns null if not
   * enough bytes have arrived yet (caller should await more data or time out).
   */
  takeFrame(expectedLength: number): Uint8Array | null {
    if (expectedLength <= 0 || this.#buffer.length < expectedLength) return null;
    const frame = this.#buffer.subarray(0, expectedLength);
    this.#buffer = this.#buffer.subarray(expectedLength);
    return Uint8Array.from(frame);
  }

  /** Bytes currently buffered (for diagnostics / desync detection). */
  get pending(): number {
    return this.#buffer.length;
  }

  /** Drop buffered bytes — used to resync after a protocol error. */
  reset(): void {
    this.#buffer = new Uint8Array(0);
  }
}
