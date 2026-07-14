/**
 * Sliding-window connection rate limiter keyed by source IP. Cheap defence
 * against a misbehaving/looping gateway hammering the listener with reconnects.
 */
export class ConnectionRateLimiter {
  readonly #windowMs = 60_000;
  readonly #max: number;
  readonly #hits = new Map<string, number[]>();

  constructor(maxPerMinute: number) {
    this.#max = maxPerMinute;
  }

  /** Returns true if a new connection from `ip` is allowed right now. */
  allow(ip: string, now: number): boolean {
    const cutoff = now - this.#windowMs;
    const arr = (this.#hits.get(ip) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.#max) {
      this.#hits.set(ip, arr);
      return false;
    }
    arr.push(now);
    this.#hits.set(ip, arr);
    return true;
  }
}
