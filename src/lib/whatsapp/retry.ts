// Slice 2b — exponential backoff with jitter for transient send failures.
//
// Retries ONLY TransientSendError (RateLimitedError is a subclass). Permanent
// errors throw on the first attempt. A per-call wall-clock budget caps total
// time spent retrying so a stuck message can't hold a serverless invocation
// open indefinitely.
//
// `sleep` and `random` are injectable so tests are deterministic (seed the
// jitter, fast-forward the waits).

import { RateLimitedError, TransientSendError } from "@/lib/whatsapp/errors";

export interface BackoffOptions {
  /** Max total attempts (initial + retries). Default 3. */
  maxAttempts?: number;
  /** Base delay for attempt 1's backoff, doubled each retry. Default 1000ms. */
  baseMs?: number;
  /** Total wall-clock budget across all attempts + waits. Default 10000ms. */
  budgetMs?: number;
  /** Jitter fraction (±). Default 0.25. */
  jitter?: number;
  /** Injectable for tests. Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. Default Math.random. */
  random?: () => number;
  /** Monotonic clock for the budget. Default performance.now via Date.now. */
  now?: () => number;
  /** Called before each attempt (1-based). */
  onAttempt?: (attempt: number) => void | Promise<void>;
  /** Called after a transient failure that will be retried. */
  onTransientFailure?: (attempt: number, err: TransientSendError) => void | Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying on TransientSendError with exponential backoff + jitter.
 * Honors RateLimitedError.retryAfter (seconds) when present. Throws the last
 * error once attempts or the budget are exhausted; rethrows non-transient
 * errors immediately (no retry).
 *
 * Returns `{ result, attempts }` so the caller can audit attempts_used.
 */
export async function withBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: BackoffOptions = {},
): Promise<{ result: T; attempts: number }> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseMs = options.baseMs ?? 1000;
  const budgetMs = options.budgetMs ?? 10_000;
  const jitter = options.jitter ?? 0.25;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const start = now();

  let attempt = 0;
  for (;;) {
    attempt += 1;
    await options.onAttempt?.(attempt);
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt };
    } catch (err) {
      const transient = err instanceof TransientSendError;
      if (!transient) throw err; // Permanent — fail immediately, no retry.
      if (attempt >= maxAttempts) throw err; // Out of attempts.

      await options.onTransientFailure?.(attempt, err as TransientSendError);

      // Backoff: base * 2^(attempt-1), ± jitter. Honor Retry-After if larger.
      const exp = baseMs * Math.pow(2, attempt - 1);
      const jitterOffset = exp * jitter * (random() * 2 - 1); // ±jitter
      let delay = Math.max(0, Math.round(exp + jitterOffset));
      if (err instanceof RateLimitedError && err.retryAfter !== undefined) {
        delay = Math.max(delay, err.retryAfter * 1000);
      }

      // Budget: if the next wait would blow the wall-clock budget, give up now
      // and surface the transient error (caller persists a terminal failure).
      const elapsed = now() - start;
      if (elapsed + delay >= budgetMs) throw err;

      await sleep(delay);
    }
  }
}
