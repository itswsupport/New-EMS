/** Sleep helper — a single awaited timer, cancellable via AbortSignal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Exponential backoff with full jitter (AWS "equal jitter" style bounded).
 * attempt is 0-based. Returns milliseconds to wait before the next retry.
 * Deterministic-friendly: pass a `rng` in tests to remove randomness.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  opts: { maxMs?: number; rng?: () => number } = {},
): number {
  const maxMs = opts.maxMs ?? 30_000;
  const rng = opts.rng ?? Math.random;
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  // Full jitter in [exp/2, exp] keeps some floor while spreading thundering herds.
  return Math.floor(exp / 2 + rng() * (exp / 2));
}
