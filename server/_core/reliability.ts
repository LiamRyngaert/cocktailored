/**
 * Backend reliability primitives — timeouts, retries with jittered backoff,
 * circuit breakers, per-IP rate limiting, TTL caching, cross-invocation
 * singletons and robust webhook delivery. No external dependencies; safe to run
 * on Vercel serverless. These make the API degrade gracefully instead of
 * hanging, crashing or hammering a struggling dependency.
 */

// ── cross-invocation singletons ───────────────────────────────────────────────
// Warm serverless instances reuse module scope. Keep shared state (breakers,
// rate limiters, caches) on globalThis so it survives across requests. Note:
// state is per-instance, not global across the fleet — for fleet-wide limits
// use a shared store (Redis). Per-instance still meaningfully bounds load.
const store = ((globalThis as unknown as { __ctReliability?: Record<string, unknown> }).__ctReliability ??= {});

export function singleton<T>(key: string, create: () => T): T {
  if (!(key in store)) store[key] = create();
  return store[key] as T;
}

// ── timeout ───────────────────────────────────────────────────────────────────
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// ── retry with exponential backoff + full jitter ──────────────────────────────
export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseMs = 120, maxMs = 2_000, isRetryable = () => true, onRetry } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      onRetry?.(err, attempt);
      // Exponential backoff with full jitter (AWS-style) to avoid thundering herds.
      const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * ceiling);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── circuit breaker ────────────────────────────────────────────────────────────
type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private state: BreakerState = "closed";
  private openedAt = 0;
  constructor(private readonly threshold: number, private readonly cooldownMs: number) {}

  /** Whether a call may proceed right now. */
  canPass(): boolean {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open"; // allow a single probe
        return true;
      }
      return false;
    }
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  get open(): boolean {
    return this.state === "open" && Date.now() - this.openedAt < this.cooldownMs;
  }
}

// ── token-bucket rate limiter (per key, e.g. per IP) ──────────────────────────
interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();
  constructor(private readonly capacity: number, private readonly refillPerSec: number) {}

  take(key: string, cost = 1): { ok: boolean; retryAfterMs: number } {
    const now = Date.now();
    this.maybeSweep(now);
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    }
    const elapsedSec = (now - b.updated) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
    b.updated = now;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, retryAfterMs: 0 };
    }
    const deficit = cost - b.tokens;
    return { ok: false, retryAfterMs: Math.ceil((deficit / this.refillPerSec) * 1000) };
  }

  // Drop stale buckets so the map never grows unbounded under many unique IPs.
  private maybeSweep(now: number): void {
    if (now - this.lastSweep < 60_000 && this.buckets.size < 10_000) return;
    this.lastSweep = now;
    const stale: string[] = [];
    this.buckets.forEach((b, key) => {
      if (now - b.updated > 600_000) stale.push(key);
    });
    stale.forEach((key) => this.buckets.delete(key));
  }
}

// ── TTL cache ──────────────────────────────────────────────────────────────────
interface Entry<T> {
  value: T;
  expires: number;
}

export class TTLCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(private readonly ttlMs: number, private readonly max = 1_000) {}

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expires) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /** Serve from cache, or run the loader and cache its result. */
  async wrap(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    this.set(key, value);
    return value;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

// ── request id + structured logging ───────────────────────────────────────────
export function requestId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export function logInfo(scope: string, msg: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), scope, msg, ...extra }));
}

export function logError(scope: string, msg: string, extra?: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", ts: new Date().toISOString(), scope, msg, ...extra }));
}

// ── background tasks (survive the response on Vercel via waitUntil) ────────────
let _waitUntil: ((p: Promise<unknown>) => void) | null | undefined;

async function resolveWaitUntil(): Promise<((p: Promise<unknown>) => void) | null> {
  if (_waitUntil !== undefined) return _waitUntil;
  try {
    const vf = (await import("@vercel/functions")) as { waitUntil?: (p: Promise<unknown>) => void };
    _waitUntil = vf.waitUntil ?? null;
  } catch {
    _waitUntil = null;
  }
  return _waitUntil;
}

/**
 * Run a fire-and-forget task that must not block the response but must not be
 * killed when the function returns. Uses Vercel `waitUntil` when available.
 */
export function runBackground(fn: () => Promise<unknown>): void {
  const p = Promise.resolve()
    .then(fn)
    .catch((err) => logError("background", "task failed", { error: String(err) }));
  resolveWaitUntil().then((wu) => {
    try {
      wu?.(p);
    } catch {
      /* best-effort */
    }
  });
}

// ── robust webhook delivery ────────────────────────────────────────────────────
export async function deliverWebhook(
  url: string,
  payload: unknown,
  opts: { attempts?: number; timeoutMs?: number; label?: string } = {}
): Promise<boolean> {
  const { attempts = 4, timeoutMs = 8_000, label = "webhook" } = opts;
  const body = JSON.stringify(payload);
  try {
    await retry(
      async () => {
        const res = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          }),
          timeoutMs,
          label
        );
        // Retry on 5xx and 429; treat other non-2xx as permanent (don't hammer).
        if (!res.ok && (res.status >= 500 || res.status === 429)) {
          throw new Error(`${label} HTTP ${res.status}`);
        }
        if (!res.ok) {
          logError(label, `non-retryable HTTP ${res.status}`);
        }
        return res;
      },
      {
        attempts,
        baseMs: 300,
        maxMs: 5_000,
        onRetry: (err, attempt) => logError(label, `attempt ${attempt} failed`, { error: String(err) }),
      }
    );
    logInfo(label, "delivered");
    return true;
  } catch (err) {
    logError(label, "all attempts exhausted", { error: String(err) });
    return false;
  }
}
