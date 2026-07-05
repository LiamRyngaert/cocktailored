import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  type Ingredient,
  InsertIngredient,
  InsertQuizSession,
  InsertUser,
  type Review,
  adminSettings,
  ingredients,
  quizSessions,
  reviews,
  users,
} from "../drizzle/schema";
import { CircuitBreaker, TTLCache, logError, retry, singleton, withTimeout, TimeoutError } from "./_core/reliability";

type Db = MySql2Database<Record<string, never>>;

// Small pool PER serverless instance. Many instances run concurrently, so the
// total connection count is (instances x POOL_SIZE) — keep this low so a burst
// of traffic never exhausts the database's connection limit. Tune via env.
const POOL_SIZE = Math.max(1, Number(process.env.DB_POOL_SIZE ?? "8") || 8);

// Cache the pool + drizzle instance on globalThis so warm invocations reuse a
// single pool instead of opening a fresh connection on every request (the main
// cause of connection exhaustion and "server has gone away" errors on Vercel).
const g = globalThis as unknown as {
  __ctPool?: mysql.Pool | null;
  __ctDb?: Db | null;
};

function createPool(url: string): mysql.Pool {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: POOL_SIZE,
    maxIdle: POOL_SIZE,
    idleTimeout: 10_000, // release idle connections quickly so bursts don't pile up
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 10_000,
  });

  // Best-effort: let Vercel Fluid Compute gracefully drain idle connections
  // before a function is suspended. No-op when not running on Vercel or when
  // the package is unavailable — the pool works fine on its own either way.
  import("@vercel/functions")
    .then((vf) => (vf as { attachDatabasePool?: (p: unknown) => void }).attachDatabasePool?.(pool))
    .catch(() => {});

  // Never let a background connection error crash the process — the pool
  // transparently reconnects on the next query.
  (pool as unknown as { on(event: "error", cb: (err: unknown) => void): void })
    .on("error", (err) => console.error("[Database] pool error (auto-recovering):", err));

  return pool;
}

export async function getDb(): Promise<Db | null> {
  if (g.__ctDb) return g.__ctDb;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    if (!g.__ctPool) g.__ctPool = createPool(url);
    g.__ctDb = drizzle(g.__ctPool);
    return g.__ctDb;
  } catch (error) {
    console.error("[Database] Failed to initialise pool:", error);
    g.__ctPool = null;
    g.__ctDb = null;
    return null;
  }
}

// Transient network/connection errors that are safe to retry — a dropped or
// reset connection is replaced by the pool on the next attempt.
const TRANSIENT_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ER_LOCK_DEADLOCK",
]);

function isTransient(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const code = String((err as { code?: string; errno?: string })?.code ?? (err as { errno?: string })?.errno ?? "");
  return TRANSIENT_CODES.has(code);
}

// Per-instance circuit breaker: after repeated DB failures, stop issuing
// queries for a short cooldown so a struggling database is not hammered while
// it recovers — requests fail fast (and cached reads still succeed) instead.
const dbBreaker = singleton("dbBreaker", () => new CircuitBreaker(5, 10_000));
const QUERY_TIMEOUT_MS = Math.max(1_000, Number(process.env.DB_QUERY_TIMEOUT_MS ?? "8000") || 8_000);

async function withRetry<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  const db = await getDb();
  if (!db) return null; // caller's in-memory branch handles this
  if (!dbBreaker.canPass()) {
    logError("db", "circuit open — failing fast");
    throw new Error("Database temporarily unavailable");
  }
  try {
    // Time-box every query so one stuck connection can never hang a request,
    // and retry transient failures with jittered exponential backoff.
    const result = await retry(() => withTimeout(fn(db), QUERY_TIMEOUT_MS, "db query"), {
      attempts: 3,
      baseMs: 120,
      maxMs: 1_500,
      isRetryable: isTransient,
    });
    dbBreaker.onSuccess();
    return result;
  } catch (err) {
    dbBreaker.onFailure();
    throw err;
  }
}

// ── read caches (per instance, short TTL) ─────────────────────────────────────
// Absorb read-heavy traffic (reviews, ingredient lists, settings) so a spike of
// concurrent users does not translate into a matching spike of DB queries.
const reviewsCache = singleton("reviewsCache", () => new TTLCache<Review[]>(60_000));
const availIngredientsCache = singleton("availIngredientsCache", () => new TTLCache<Ingredient[]>(20_000));
const allIngredientsCache = singleton("allIngredientsCache", () => new TTLCache<Ingredient[]>(10_000));
const settingsCache = singleton("settingsCache", () => new TTLCache<string | null>(30_000));

function invalidateIngredientCaches(): void {
  availIngredientsCache.clear();
  allIngredientsCache.clear();
}

/**
 * Live backend status — used by the health endpoint and the admin dashboard to
 * confirm the app is actually linked to a durable database (and not silently
 * running on the ephemeral in-memory fallback).
 */
export async function getDbStatus(): Promise<{
  mode: "database" | "memory";
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}> {
  if (!process.env.DATABASE_URL) {
    return { mode: "memory", ok: true, latencyMs: null };
  }
  const start = Date.now();
  try {
    const db = await getDb();
    if (!db) return { mode: "database", ok: false, latencyMs: null, error: "pool unavailable" };
    await db.execute(sql`SELECT 1`);
    return { mode: "database", ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { mode: "database", ok: false, latencyMs: null, error: (err as Error).message };
  }
}

// ---- In-memory fallback (used when DATABASE_URL is not configured) ----
const _memSessions = new Map<string, InsertQuizSession & { id: number; createdAt: Date; updatedAt: Date }>();
const _memSettings = new Map<string, string>();
let _memSessionCounter = 1;

const DEFAULT_INGREDIENTS: Array<{ id: number; name: string; category: string; available: boolean; isCustom: boolean; createdAt: Date }> = [
  { id: 1, name: "Vodka", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 2, name: "White Rum", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 3, name: "Dark Rum", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 4, name: "Gin", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 5, name: "Tequila", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 6, name: "Whiskey", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 7, name: "Triple Sec", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 8, name: "Kahlua", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 9, name: "Amaretto", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 10, name: "Coconut Rum", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 11, name: "Fresh Lime Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 12, name: "Fresh Lemon Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 13, name: "Orange Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 14, name: "Pineapple Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 15, name: "Cranberry Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 16, name: "Simple Syrup", category: "syrups", available: true, isCustom: false, createdAt: new Date() },
  { id: 17, name: "Grenadine", category: "syrups", available: true, isCustom: false, createdAt: new Date() },
  { id: 18, name: "Agave Syrup", category: "syrups", available: true, isCustom: false, createdAt: new Date() },
  { id: 19, name: "Soda Water", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 20, name: "Tonic Water", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 21, name: "Ginger Beer", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 22, name: "Cola", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 23, name: "Angostura Bitters", category: "bitters", available: true, isCustom: false, createdAt: new Date() },
  { id: 24, name: "Mint", category: "garnishes", available: true, isCustom: false, createdAt: new Date() },
  { id: 25, name: "Lime Wedge", category: "garnishes", available: true, isCustom: false, createdAt: new Date() },
];

// ---- Users ----
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await withRetry((d) => d.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet }));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await withRetry((d) => d.select().from(users).where(eq(users.openId, openId)).limit(1));
  return result && result.length > 0 ? result[0] : undefined;
}

// ---- Quiz Sessions ----
export async function createQuizSession(data: InsertQuizSession) {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    // Bound the in-memory fallback so a long-running dev/process can't leak
    // memory: evict the oldest session once we exceed the cap.
    if (_memSessions.size >= 5_000) {
      const oldest = _memSessions.keys().next().value;
      if (oldest !== undefined) _memSessions.delete(oldest);
    }
    _memSessions.set(data.sessionId, { ...data, id: _memSessionCounter++, createdAt: now, updatedAt: now });
    return;
  }
  await withRetry((d) => d.insert(quizSessions).values(data));
}

export async function getQuizSession(sessionId: string) {
  const db = await getDb();
  if (!db) return _memSessions.get(sessionId);
  const result = await withRetry((d) =>
    d.select().from(quizSessions).where(eq(quizSessions.sessionId, sessionId)).limit(1));
  return result && result.length > 0 ? result[0] : undefined;
}

export async function updateQuizSession(
  sessionId: string,
  data: Partial<InsertQuizSession>
) {
  const db = await getDb();
  if (!db) {
    const existing = _memSessions.get(sessionId);
    if (existing) _memSessions.set(sessionId, { ...existing, ...data, updatedAt: new Date() });
    return;
  }
  await withRetry((d) => d.update(quizSessions).set(data).where(eq(quizSessions.sessionId, sessionId)));
}

export async function getAllQuizSessions() {
  const db = await getDb();
  if (!db) return Array.from(_memSessions.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200);
  return (await withRetry((d) => d.select().from(quizSessions).orderBy(desc(quizSessions.createdAt)).limit(200))) ?? [];
}

// ---- Ingredients ----
export async function getAllIngredients() {
  const db = await getDb();
  if (!db) return DEFAULT_INGREDIENTS;
  return allIngredientsCache.wrap("all", async () =>
    (await withRetry((d) => d.select().from(ingredients).orderBy(ingredients.category, ingredients.name))) ?? []);
}

export async function getAvailableIngredients() {
  const db = await getDb();
  if (!db) return DEFAULT_INGREDIENTS.filter((i) => i.available);
  return availIngredientsCache.wrap("all", async () =>
    (await withRetry((d) =>
      d.select().from(ingredients).where(eq(ingredients.available, true)).orderBy(ingredients.category, ingredients.name))) ?? []);
}

export async function updateIngredientAvailability(id: number, available: boolean) {
  const db = await getDb();
  if (!db) {
    const ing = DEFAULT_INGREDIENTS.find((i) => i.id === id);
    if (ing) ing.available = available;
    return;
  }
  await withRetry((d) => d.update(ingredients).set({ available }).where(eq(ingredients.id, id)));
  invalidateIngredientCaches();
}

export async function addCustomIngredient(data: InsertIngredient) {
  const db = await getDb();
  if (!db) {
    DEFAULT_INGREDIENTS.push({ ...data, available: data.available ?? true, id: DEFAULT_INGREDIENTS.length + 1, isCustom: true, createdAt: new Date() });
    return;
  }
  await withRetry((d) => d.insert(ingredients).values({ ...data, isCustom: true }));
  invalidateIngredientCaches();
}

export async function deleteIngredient(id: number) {
  const db = await getDb();
  if (!db) {
    const idx = DEFAULT_INGREDIENTS.findIndex((i) => i.id === id && i.isCustom);
    if (idx >= 0) DEFAULT_INGREDIENTS.splice(idx, 1);
    return;
  }
  await withRetry((d) => d.delete(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.isCustom, true))));
  invalidateIngredientCaches();
}

// ---- Admin Settings ----
export async function getAdminSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return _memSettings.get(key) ?? null;
  return settingsCache.wrap(key, async () => {
    const result = await withRetry((d) =>
      d.select().from(adminSettings).where(eq(adminSettings.key, key)).limit(1));
    return result && result.length > 0 ? (result[0].value ?? null) : null;
  });
}

export async function setAdminSetting(key: string, value: string) {
  const db = await getDb();
  if (!db) { _memSettings.set(key, value); return; }
  await withRetry((d) => d.insert(adminSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } }));
  settingsCache.delete(key);
}

export async function getAllAdminSettings() {
  const db = await getDb();
  if (!db) return Array.from(_memSettings.entries()).map(([key, value], id) => ({ id, key, value, updatedAt: new Date() }));
  return (await withRetry((d) => d.select().from(adminSettings))) ?? [];
}

// ---- Reviews ----
export async function getAllReviews() {
  const db = await getDb();
  if (!db) return [];
  return reviewsCache.wrap("all", async () =>
    (await withRetry((d) => d.select().from(reviews).orderBy(reviews.createdAt))) ?? []);
}
