// api/index.ts
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/routers.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
import { nanoid } from "nanoid";
import { z as z2 } from "zod";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// server/_core/env.ts
var ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  s3Region: process.env.S3_REGION ?? "eu-central",
  // Legacy stubs — unused, kept for compilation only
  appId: "",
  oAuthServerUrl: "",
  ownerOpenId: "",
  forgeApiUrl: "",
  forgeApiKey: ""
};

// server/_core/llm.ts
import Anthropic from "@anthropic-ai/sdk";
var _client = null;
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!_client) {
    _client = new Anthropic({
      apiKey: key,
      maxRetries: Math.max(0, Number(process.env.LLM_MAX_RETRIES ?? "2") || 2),
      timeout: Math.max(5e3, Number(process.env.LLM_TIMEOUT_MS ?? "45000") || 45e3)
    });
  }
  return _client;
}
function convertImageUrl(url) {
  if (url.startsWith("data:")) {
    const commaIdx = url.indexOf(",");
    const header = url.slice(0, commaIdx);
    const data = url.slice(commaIdx + 1);
    const mediaType = header.split(";")[0].split(":")[1];
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  }
  return { type: "image", source: { type: "url", url } };
}
function convertContent(content) {
  const parts = Array.isArray(content) ? content : [content];
  return parts.flatMap((part) => {
    if (typeof part === "string") return [{ type: "text", text: part }];
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "image_url") return [convertImageUrl(part.image_url.url)];
    return [{ type: "text", text: `[File: ${part.file_url.url}]` }];
  });
}
function extractSystemText(messages) {
  return messages.filter((m) => m.role === "system").map((m) => {
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c.map((p) => typeof p === "string" ? p : p.type === "text" ? p.text : "").join("");
    }
    return "";
  }).join("\n");
}
async function invokeLLM(params) {
  const client = getClient();
  const {
    messages,
    model = "claude-sonnet-4-5",
    maxTokens,
    max_tokens,
    responseFormat,
    response_format
  } = params;
  let systemText = extractSystemText(messages);
  const fmt = responseFormat ?? response_format;
  if (fmt?.type === "json_schema" && fmt.json_schema) {
    systemText += `

Respond with valid JSON matching this schema:
` + JSON.stringify(fmt.json_schema.schema, null, 2) + `
Return only the raw JSON object \u2014 no markdown fences.`;
  } else if (fmt?.type === "json_object") {
    systemText += "\n\nRespond with a valid JSON object only \u2014 no markdown fences.";
  }
  const anthropicMessages = messages.filter((m) => m.role !== "system").map((m) => {
    if (m.role === "user") {
      return { role: "user", content: convertContent(m.content) };
    }
    if (m.role === "assistant") {
      const text3 = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => typeof p === "string" ? p : p.type === "text" ? p.text : "").join("") : "";
      return { role: "assistant", content: text3 };
    }
    const text2 = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return { role: "user", content: text2 };
  });
  const response = await client.messages.create({
    model,
    system: systemText.trim() || void 0,
    messages: anthropicMessages,
    max_tokens: max_tokens ?? maxTokens ?? 4096
  });
  const textContent = response.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  return {
    id: response.id,
    created: Math.floor(Date.now() / 1e3),
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: textContent },
        finish_reason: response.stop_reason ?? null
      }
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens
    }
  };
}

// server/_core/reliability.ts
var store = globalThis.__ctReliability ??= {};
function singleton(key, create) {
  if (!(key in store)) store[key] = create();
  return store[key];
}
var TimeoutError = class extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
};
function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function retry(fn, opts = {}) {
  const { attempts = 3, baseMs = 120, maxMs = 2e3, isRetryable = () => true, onRetry } = opts;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      onRetry?.(err, attempt);
      const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * ceiling);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
var CircuitBreaker = class {
  constructor(threshold, cooldownMs) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }
  failures = 0;
  state = "closed";
  openedAt = 0;
  /** Whether a call may proceed right now. */
  canPass() {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }
  onSuccess() {
    this.failures = 0;
    this.state = "closed";
  }
  onFailure() {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }
  get open() {
    return this.state === "open" && Date.now() - this.openedAt < this.cooldownMs;
  }
};
var RateLimiter = class {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
  }
  buckets = /* @__PURE__ */ new Map();
  lastSweep = Date.now();
  take(key, cost = 1) {
    const now = Date.now();
    this.maybeSweep(now);
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    }
    const elapsedSec = (now - b.updated) / 1e3;
    b.tokens = Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
    b.updated = now;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, retryAfterMs: 0 };
    }
    const deficit = cost - b.tokens;
    return { ok: false, retryAfterMs: Math.ceil(deficit / this.refillPerSec * 1e3) };
  }
  // Drop stale buckets so the map never grows unbounded under many unique IPs.
  maybeSweep(now) {
    if (now - this.lastSweep < 6e4 && this.buckets.size < 1e4) return;
    this.lastSweep = now;
    const stale = [];
    this.buckets.forEach((b, key) => {
      if (now - b.updated > 6e5) stale.push(key);
    });
    stale.forEach((key) => this.buckets.delete(key));
  }
};
var TTLCache = class {
  constructor(ttlMs, max = 1e3) {
    this.ttlMs = ttlMs;
    this.max = max;
  }
  map = /* @__PURE__ */ new Map();
  get(key) {
    const e = this.map.get(key);
    if (!e) return void 0;
    if (Date.now() > e.expires) {
      this.map.delete(key);
      return void 0;
    }
    return e.value;
  }
  set(key, value) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== void 0) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
  /** Serve from cache, or run the loader and cache its result. */
  async wrap(key, loader) {
    const hit = this.get(key);
    if (hit !== void 0) return hit;
    const value = await loader();
    this.set(key, value);
    return value;
  }
  delete(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
};
function requestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function logInfo(scope, msg, extra) {
  console.log(JSON.stringify({ level: "info", ts: (/* @__PURE__ */ new Date()).toISOString(), scope, msg, ...extra }));
}
function logError(scope, msg, extra) {
  console.error(JSON.stringify({ level: "error", ts: (/* @__PURE__ */ new Date()).toISOString(), scope, msg, ...extra }));
}
var _waitUntil;
async function resolveWaitUntil() {
  if (_waitUntil !== void 0) return _waitUntil;
  try {
    const vf = await import("@vercel/functions");
    _waitUntil = vf.waitUntil ?? null;
  } catch {
    _waitUntil = null;
  }
  return _waitUntil;
}
function runBackground(fn) {
  const p = Promise.resolve().then(fn).catch((err) => logError("background", "task failed", { error: String(err) }));
  resolveWaitUntil().then((wu) => {
    try {
      wu?.(p);
    } catch {
    }
  });
}
async function deliverWebhook(url, payload, opts = {}) {
  const { attempts = 4, timeoutMs = 8e3, label = "webhook" } = opts;
  const body = JSON.stringify(payload);
  try {
    await retry(
      async () => {
        const res = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
          }),
          timeoutMs,
          label
        );
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
        maxMs: 5e3,
        onRetry: (err, attempt) => logError(label, `attempt ${attempt} failed`, { error: String(err) })
      }
    );
    logInfo(label, "delivered");
    return true;
  } catch (err) {
    logError(label, "all attempts exhausted", { error: String(err) });
    return false;
  }
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/db.ts
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

// drizzle/schema.ts
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var quizSessions = mysqlTable("quiz_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 64 }).notNull().unique(),
  guestName: varchar("guestName", { length: 128 }),
  answers: json("answers").notNull(),
  // Array of {questionId, question, answer}
  flavorProfile: json("flavorProfile"),
  // Derived flavor profile object
  recipes: json("recipes"),
  // Array of 3 generated cocktail recipes
  selectedRecipeIndex: int("selectedRecipeIndex").default(0),
  // Order inquiry fields
  orderEmail: varchar("orderEmail", { length: 320 }),
  orderPhone: varchar("orderPhone", { length: 64 }),
  orderSubmitted: boolean("orderSubmitted").default(false).notNull(),
  webhookSent: boolean("webhookSent").default(false).notNull(),
  completed: boolean("completed").default(false).notNull(),
  // GDPR consent audit trail — stored at time of order submission
  consentComms: boolean("consentComms").default(false),
  consentDataSharing: boolean("consentDataSharing").default(false),
  consentFormVersion: varchar("consentFormVersion", { length: 16 }),
  consentIp: varchar("consentIp", { length: 64 }),
  consentTimestamp: timestamp("consentTimestamp"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (t2) => ({
  // Admin list orders by newest first and filters to submitted orders.
  createdAtIdx: index("quiz_sessions_created_at_idx").on(t2.createdAt),
  orderSubmittedIdx: index("quiz_sessions_order_submitted_idx").on(t2.orderSubmitted)
}));
var ingredients = mysqlTable("ingredients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  // spirits, mixers, liqueurs, garnishes, syrups, juices, bitters
  available: boolean("available").default(true).notNull(),
  isCustom: boolean("isCustom").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (t2) => ({
  // Reads filter on availability and order by category.
  availableIdx: index("ingredients_available_idx").on(t2.available),
  categoryIdx: index("ingredients_category_idx").on(t2.category)
}));
var adminSettings = mysqlTable("admin_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  text: text("text").notNull(),
  rating: int("rating").notNull().default(5),
  color: varchar("color", { length: 32 }).notNull().default("#ff6b35"),
  emoji: varchar("emoji", { length: 8 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/sshTunnel.ts
import { Duplex } from "node:stream";
import { Client } from "ssh2";
function sshTunnelConfigured() {
  return Boolean(process.env.SSH_HOST && process.env.SSH_PRIVATE_KEY);
}
var g = globalThis;
function connectSsh() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client)).on("error", (err) => {
      g.__ctSshClient = null;
      g.__ctSshReady = null;
      reject(err);
    }).on("close", () => {
      if (g.__ctSshClient === client) {
        g.__ctSshClient = null;
        g.__ctSshReady = null;
      }
    }).connect({
      host: process.env.SSH_HOST,
      port: Number(process.env.SSH_PORT ?? "22"),
      username: process.env.SSH_USER || "root",
      privateKey: process.env.SSH_PRIVATE_KEY,
      passphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE || void 0,
      readyTimeout: 1e4,
      keepaliveInterval: 15e3
    });
  });
}
function getSshClient() {
  if (g.__ctSshClient) return Promise.resolve(g.__ctSshClient);
  if (!g.__ctSshReady) {
    g.__ctSshReady = connectSsh().then((client) => {
      g.__ctSshClient = client;
      return client;
    });
  }
  return g.__ctSshReady;
}
function createProxyStream(openRealChannel) {
  let real = null;
  let destroyed = false;
  const pendingWrites = [];
  const proxy = new Duplex({
    read() {
      real?.resume();
    },
    write(chunk, _enc, cb) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (real) real.write(buf, cb);
      else pendingWrites.push({ chunk: buf, cb });
    },
    final(cb) {
      real ? real.end(cb) : cb();
    },
    destroy(err, cb) {
      real?.destroy();
      cb(err);
    }
  });
  openRealChannel().then((channel) => {
    if (destroyed) return channel.destroy();
    real = channel;
    for (const { chunk, cb } of pendingWrites) real.write(chunk, cb);
    pendingWrites.length = 0;
    channel.on("data", (d) => {
      if (!proxy.push(d)) channel.pause();
    });
    proxy.on("drain", () => channel.resume());
    channel.on("end", () => proxy.push(null));
    channel.on("close", () => proxy.destroy());
    channel.on("error", (err) => proxy.destroy(err));
  }).catch((err) => proxy.destroy(err));
  proxy.on("close", () => {
    destroyed = true;
  });
  return proxy;
}
function createSshTunnelStreamFactory() {
  const remoteHost = process.env.DB_TUNNEL_REMOTE_HOST || "127.0.0.1";
  const remotePort = Number(process.env.DB_TUNNEL_REMOTE_PORT ?? "3306");
  return function streamFactory() {
    return createProxyStream(
      () => new Promise((resolve, reject) => {
        getSshClient().then((client) => {
          client.forwardOut("127.0.0.1", 0, remoteHost, remotePort, (err, stream) => {
            if (err) reject(err);
            else resolve(stream);
          });
        }).catch(reject);
      })
    );
  };
}

// server/db.ts
var POOL_SIZE = Math.max(1, Number(process.env.DB_POOL_SIZE ?? "8") || 8);
var g2 = globalThis;
function resolveSsl(url) {
  const flag = (process.env.DB_SSL ?? "").toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return void 0;
  const managed = /psdb\.cloud|planetscale|aivencloud\.com|\.rds\.amazonaws\.com|azure|scalegrid/i;
  if (flag === "true" || flag === "1" || flag === "on" || managed.test(url)) {
    return { rejectUnauthorized: true };
  }
  return void 0;
}
function createPool(url) {
  const useSshTunnel = sshTunnelConfigured();
  const pool = mysql.createPool({
    uri: url,
    ssl: useSshTunnel ? void 0 : resolveSsl(url),
    stream: useSshTunnel ? createSshTunnelStreamFactory() : void 0,
    connectionLimit: POOL_SIZE,
    maxIdle: POOL_SIZE,
    idleTimeout: 1e4,
    // release idle connections quickly so bursts don't pile up
    enableKeepAlive: true,
    keepAliveInitialDelay: 1e4,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 1e4
  });
  if (useSshTunnel) logInfo("db", "connecting via SSH tunnel", { host: process.env.SSH_HOST });
  import("@vercel/functions").then((vf) => vf.attachDatabasePool?.(pool)).catch(() => {
  });
  pool.on("error", (err) => console.error("[Database] pool error (auto-recovering):", err));
  return pool;
}
async function getDb() {
  if (g2.__ctDb) return g2.__ctDb;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    if (!g2.__ctPool) g2.__ctPool = createPool(url);
    const db = drizzle(g2.__ctPool);
    await ensureSchemaOnce(db);
    g2.__ctDb = db;
    return g2.__ctDb;
  } catch (error) {
    console.error("[Database] Failed to initialise pool:", error);
    g2.__ctPool = null;
    g2.__ctDb = null;
    return null;
  }
}
function ensureSchemaOnce(db) {
  return g2.__ctSchemaReady ??= ensureSchema(db).catch((err) => {
    logError("db", "schema bootstrap failed (continuing)", { error: String(err) });
  });
}
var TRANSIENT_CODES = /* @__PURE__ */ new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ER_LOCK_DEADLOCK"
]);
function isTransient(err) {
  if (err instanceof TimeoutError) return true;
  const code = String(err?.code ?? err?.errno ?? "");
  return TRANSIENT_CODES.has(code);
}
var dbBreaker = singleton("dbBreaker", () => new CircuitBreaker(5, 1e4));
var QUERY_TIMEOUT_MS = Math.max(1e3, Number(process.env.DB_QUERY_TIMEOUT_MS ?? "8000") || 8e3);
async function withRetry(fn) {
  const db = await getDb();
  if (!db) return null;
  if (!dbBreaker.canPass()) {
    logError("db", "circuit open \u2014 failing fast");
    throw new Error("Database temporarily unavailable");
  }
  try {
    const result = await retry(() => withTimeout(fn(db), QUERY_TIMEOUT_MS, "db query"), {
      attempts: 3,
      baseMs: 120,
      maxMs: 1500,
      isRetryable: isTransient
    });
    dbBreaker.onSuccess();
    return result;
  } catch (err) {
    dbBreaker.onFailure();
    throw err;
  }
}
var reviewsCache = singleton("reviewsCache", () => new TTLCache(6e4));
var availIngredientsCache = singleton("availIngredientsCache", () => new TTLCache(2e4));
var allIngredientsCache = singleton("allIngredientsCache", () => new TTLCache(1e4));
var settingsCache = singleton("settingsCache", () => new TTLCache(3e4));
function invalidateIngredientCaches() {
  availIngredientsCache.clear();
  allIngredientsCache.clear();
}
async function getDbStatus() {
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
    const cause = err.cause;
    const detail = cause?.code ? `${cause.code}${cause.message ? `: ${cause.message}` : ""}` : err.message;
    return { mode: "database", ok: false, latencyMs: null, error: detail };
  }
}
var _memSessions = /* @__PURE__ */ new Map();
var _memSettings = /* @__PURE__ */ new Map();
var _memSessionCounter = 1;
var DEFAULT_INGREDIENTS = [
  { id: 1, name: "Vodka", category: "spirits", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 2, name: "White Rum", category: "spirits", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 3, name: "Dark Rum", category: "spirits", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 4, name: "Gin", category: "spirits", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 5, name: "Tequila", category: "spirits", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 6, name: "Whiskey", category: "spirits", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 7, name: "Triple Sec", category: "liqueurs", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 8, name: "Kahlua", category: "liqueurs", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 9, name: "Amaretto", category: "liqueurs", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 10, name: "Coconut Rum", category: "liqueurs", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 11, name: "Fresh Lime Juice", category: "juices", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 12, name: "Fresh Lemon Juice", category: "juices", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 13, name: "Orange Juice", category: "juices", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 14, name: "Pineapple Juice", category: "juices", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 15, name: "Cranberry Juice", category: "juices", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 16, name: "Simple Syrup", category: "syrups", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 17, name: "Grenadine", category: "syrups", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 18, name: "Agave Syrup", category: "syrups", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 19, name: "Soda Water", category: "mixers", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 20, name: "Tonic Water", category: "mixers", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 21, name: "Ginger Beer", category: "mixers", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 22, name: "Cola", category: "mixers", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 23, name: "Angostura Bitters", category: "bitters", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 24, name: "Mint", category: "garnishes", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() },
  { id: 25, name: "Lime Wedge", category: "garnishes", available: true, isCustom: false, createdAt: /* @__PURE__ */ new Date() }
];
var SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    openId VARCHAR(64) NOT NULL,
    name TEXT,
    email VARCHAR(320),
    loginMethod VARCHAR(64),
    role ENUM('user','admin') NOT NULL DEFAULT 'user',
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY users_openId_unique (openId)
  )`,
  `CREATE TABLE IF NOT EXISTS quiz_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sessionId VARCHAR(64) NOT NULL,
    guestName VARCHAR(128),
    answers JSON NOT NULL,
    flavorProfile JSON,
    recipes JSON,
    selectedRecipeIndex INT DEFAULT 0,
    orderEmail VARCHAR(320),
    orderPhone VARCHAR(64),
    orderSubmitted BOOLEAN NOT NULL DEFAULT FALSE,
    webhookSent BOOLEAN NOT NULL DEFAULT FALSE,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    consentComms BOOLEAN DEFAULT FALSE,
    consentDataSharing BOOLEAN DEFAULT FALSE,
    consentFormVersion VARCHAR(16),
    consentIp VARCHAR(64),
    consentTimestamp TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY quiz_sessions_sessionId_unique (sessionId),
    KEY quiz_sessions_created_at_idx (createdAt),
    KEY quiz_sessions_order_submitted_idx (orderSubmitted)
  )`,
  `CREATE TABLE IF NOT EXISTS ingredients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    available BOOLEAN NOT NULL DEFAULT TRUE,
    isCustom BOOLEAN NOT NULL DEFAULT FALSE,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ingredients_available_idx (available),
    KEY ingredients_category_idx (category)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(64) NOT NULL,
    value TEXT,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY admin_settings_key_unique (\`key\`)
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    \`text\` TEXT NOT NULL,
    rating INT NOT NULL DEFAULT 5,
    color VARCHAR(32) NOT NULL DEFAULT '#ff6b35',
    emoji VARCHAR(8) NOT NULL DEFAULT '',
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
];
async function ensureSchema(db) {
  for (const stmt of SCHEMA_STATEMENTS) {
    await withTimeout(db.execute(sql.raw(stmt)), 15e3, "schema bootstrap");
  }
  const countRows = await withTimeout(
    db.execute(sql`SELECT COUNT(*) AS c FROM ingredients`),
    1e4,
    "ingredient count"
  );
  const count = Number(countRows?.[0]?.[0]?.c ?? 0);
  if (count === 0) {
    await db.insert(ingredients).values(
      DEFAULT_INGREDIENTS.map((i) => ({ name: i.name, category: i.category, available: i.available, isCustom: false }))
    );
    logInfo("db", "seeded default ingredients", { count: DEFAULT_INGREDIENTS.length });
  }
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  const assignNullable = (field) => {
    const value = user[field];
    if (value === void 0) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  }
  if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  await withRetry((d) => d.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet }));
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await withRetry((d) => d.select().from(users).where(eq(users.openId, openId)).limit(1));
  return result && result.length > 0 ? result[0] : void 0;
}
async function createQuizSession(data) {
  const db = await getDb();
  if (!db) {
    const now = /* @__PURE__ */ new Date();
    if (_memSessions.size >= 5e3) {
      const oldest = _memSessions.keys().next().value;
      if (oldest !== void 0) _memSessions.delete(oldest);
    }
    _memSessions.set(data.sessionId, { ...data, id: _memSessionCounter++, createdAt: now, updatedAt: now });
    return;
  }
  await withRetry((d) => d.insert(quizSessions).values(data));
}
async function getQuizSession(sessionId) {
  const db = await getDb();
  if (!db) return _memSessions.get(sessionId);
  const result = await withRetry((d) => d.select().from(quizSessions).where(eq(quizSessions.sessionId, sessionId)).limit(1));
  return result && result.length > 0 ? result[0] : void 0;
}
async function updateQuizSession(sessionId, data) {
  const db = await getDb();
  if (!db) {
    const existing = _memSessions.get(sessionId);
    if (existing) _memSessions.set(sessionId, { ...existing, ...data, updatedAt: /* @__PURE__ */ new Date() });
    return;
  }
  await withRetry((d) => d.update(quizSessions).set(data).where(eq(quizSessions.sessionId, sessionId)));
}
async function getAllQuizSessions() {
  const db = await getDb();
  if (!db) return Array.from(_memSessions.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200);
  return await withRetry((d) => d.select().from(quizSessions).orderBy(desc(quizSessions.createdAt)).limit(200)) ?? [];
}
async function getAllIngredients() {
  const db = await getDb();
  if (!db) return DEFAULT_INGREDIENTS;
  return allIngredientsCache.wrap("all", async () => await withRetry((d) => d.select().from(ingredients).orderBy(ingredients.category, ingredients.name)) ?? []);
}
async function getAvailableIngredients() {
  const db = await getDb();
  if (!db) return DEFAULT_INGREDIENTS.filter((i) => i.available);
  return availIngredientsCache.wrap("all", async () => await withRetry((d) => d.select().from(ingredients).where(eq(ingredients.available, true)).orderBy(ingredients.category, ingredients.name)) ?? []);
}
async function updateIngredientAvailability(id, available) {
  const db = await getDb();
  if (!db) {
    const ing = DEFAULT_INGREDIENTS.find((i) => i.id === id);
    if (ing) ing.available = available;
    return;
  }
  await withRetry((d) => d.update(ingredients).set({ available }).where(eq(ingredients.id, id)));
  invalidateIngredientCaches();
}
async function addCustomIngredient(data) {
  const db = await getDb();
  if (!db) {
    DEFAULT_INGREDIENTS.push({ ...data, available: data.available ?? true, id: DEFAULT_INGREDIENTS.length + 1, isCustom: true, createdAt: /* @__PURE__ */ new Date() });
    return;
  }
  await withRetry((d) => d.insert(ingredients).values({ ...data, isCustom: true }));
  invalidateIngredientCaches();
}
async function deleteIngredient(id) {
  const db = await getDb();
  if (!db) {
    const idx = DEFAULT_INGREDIENTS.findIndex((i) => i.id === id && i.isCustom);
    if (idx >= 0) DEFAULT_INGREDIENTS.splice(idx, 1);
    return;
  }
  await withRetry((d) => d.delete(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.isCustom, true))));
  invalidateIngredientCaches();
}
async function getAdminSetting(key) {
  const db = await getDb();
  if (!db) return _memSettings.get(key) ?? null;
  return settingsCache.wrap(key, async () => {
    const result = await withRetry((d) => d.select().from(adminSettings).where(eq(adminSettings.key, key)).limit(1));
    return result && result.length > 0 ? result[0].value ?? null : null;
  });
}
async function setAdminSetting(key, value) {
  const db = await getDb();
  if (!db) {
    _memSettings.set(key, value);
    return;
  }
  await withRetry((d) => d.insert(adminSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } }));
  settingsCache.delete(key);
}
async function getAllAdminSettings() {
  const db = await getDb();
  if (!db) return Array.from(_memSettings.entries()).map(([key, value], id) => ({ id, key, value, updatedAt: /* @__PURE__ */ new Date() }));
  return await withRetry((d) => d.select().from(adminSettings)) ?? [];
}
async function getAllReviews() {
  const db = await getDb();
  if (!db) return [];
  return reviewsCache.wrap("all", async () => await withRetry((d) => d.select().from(reviews).orderBy(reviews.createdAt)) ?? []);
}

// server/_core/notification.ts
async function notifyOwner(payload) {
  console.log("[Notification] Owner notification (not delivered):", payload.title);
  return false;
}

// server/_core/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return { ...shape, message: "Internal server error" };
    }
    return shape;
  }
});
var router = t.router;
var observability = t.middleware(async ({ path, type, next }) => {
  const id = requestId();
  const start = Date.now();
  const res = await next();
  const ms = Date.now() - start;
  if (!res.ok) {
    logError("trpc", "procedure failed", { id, path, type, ms, code: res.error.code });
  } else if (ms > 1e3) {
    logInfo("trpc", "slow procedure", { id, path, type, ms });
  }
  return res;
});
var publicProcedure = t.procedure.use(observability);
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = publicProcedure.use(requireUser);
var adminProcedure = publicProcedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  /**
   * Live backend status — confirms the app is linked to a durable database and
   * measures round-trip latency. Powers the admin "Backend status" widget and
   * any external uptime monitor pointed at the /api/health route.
   */
  status: publicProcedure.query(async () => {
    const db = await getDbStatus();
    return { ok: db.ok, db, timestamp: Date.now() };
  }),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
var ADMIN_SESSION_KEY = "beast_admin_session";
var WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/8nDL9BCU3hp9982tGYT1/webhook-trigger/71aa3d40-0ead-46d9-9255-2bbe7caa770d";
function sanitizeText(input) {
  return input.replace(/<[^>]*>/g, "").trim();
}
var generateLimiter = singleton("rl:generate", () => new RateLimiter(40, 1));
var scanLimiter = singleton("rl:scan", () => new RateLimiter(15, 0.3));
var loginLimiter = singleton("rl:login", () => new RateLimiter(10, 0.1));
var orderLimiter = singleton("rl:order", () => new RateLimiter(40, 1));
function clientIp(ctx) {
  return ctx.req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? ctx.req.socket?.remoteAddress ?? "unknown";
}
function enforceRate(limiter, key) {
  const { ok, retryAfterMs } = limiter.take(key);
  if (!ok) {
    throw new TRPCError2({
      code: "TOO_MANY_REQUESTS",
      message: `Te veel verzoeken. Probeer over ${Math.ceil(retryAfterMs / 1e3)} seconden opnieuw.`
    });
  }
}
function isAdminSession(ctx) {
  const cookie = ctx.req.headers.cookie ?? "";
  return cookie.includes(`${ADMIN_SESSION_KEY}=authenticated`);
}
async function generateCocktailWithClaude(answers, availableIngredients, allergies) {
  const ingredientList = availableIngredients.map((i) => `${i.name} (${i.category})`).join(", ");
  const answersText = answers.map((a) => `Q: ${a.question}
A: ${a.answer}`).join("\n\n");
  const systemPrompt = `You are a world-class cocktail psychologist and master mixologist. You use flavor psychology research to create deeply personalised cocktail recipes.

LANGUAGE: You MUST write ALL output in Dutch (Nederlands). This includes cocktail names, taglines, instructions, flavor notes, personality descriptions, profile explanations \u2014 absolutely everything. Use natural, fluent Dutch. Do not use English anywhere in your output.


FLAVOR PSYCHOLOGY PRINCIPLES you must apply:
1. Sweet preference links to agreeableness, warmth, and social openness. Sweet lovers enjoy approachable, fruity, crowd-pleasing cocktails.
2. Bitter preference links to openness to experience, complexity-seeking, and sophistication. Bitter lovers enjoy Negroni-style, amaro-forward, layered drinks.
3. Sour preference links to positive emotionality, assertiveness, and risk-taking. Sour lovers enjoy citrus-forward, bright, energetic cocktails.
4. Spicy/heat preference links to sensation-seeking, extraversion, and high testosterone. Spice lovers enjoy chili-infused, warming, bold cocktails.
5. Salty preference links to anxiety sensitivity and need for comfort. Salt lovers enjoy well-rounded, balanced, comforting cocktails.
6. Umami/savory preference links to intellectual curiosity and culinary adventurousness. Savory lovers enjoy unexpected, complex, chef-inspired cocktails.
7. Anxious personalities prefer familiar, sweeter, lower-ABV cocktails with comforting flavors.
8. Open/curious personalities prefer novel ingredients, unusual combinations, and complex flavor layering.
9. Extraverts prefer vibrant, colorful, shareable, visually striking cocktails.
10. Introverts prefer subtle, nuanced, contemplative cocktails with depth.
11. Mood-seeking behavior maps to spirit choice: rum/tequila for energy, whiskey/cognac for warmth and contemplation.
12. Social context maps to cocktail style: party drinks are fun and fruity, date drinks are elegant and sensual, solo drinks are complex and rewarding.
13. Time of day preference maps to strength and style: daytime means lighter and refreshing, evening means richer and stronger.
14. Adventure level maps to ingredient novelty: adventurous people get exotic ingredients, conservative people get classic combinations with a twist.
15. Color preference has psychological meaning: red/orange people are passionate and energetic, blue/green people are calm and creative, purple people are imaginative and spiritual.

CRITICAL RULES:
- ALL measurements MUST be in milliliters (ml) only. No ounces, no cups, no tablespoons.
- ONLY use ingredients from the provided available ingredients list.
- Generate exactly 3 distinct cocktail variants that each express a different facet of the person's personality.
- Each recipe must be complete, buildable by a bartender, and genuinely delicious.
- Never use placeholder text or generic descriptions. Be specific and personal.
- Do not use em dashes (use commas or periods instead). Do not use the word "AI" or "algorithm" anywhere.
- Write as if you are a wise, warm bartender who truly knows this person.
- colorHex MUST be a medium to light color (never very dark). The UI has a black background, so dark colors like #1a0a00 or #0d0020 are invisible. Use vibrant, saturated mid-to-light tones. Brightness should be at least 40% in HSL.
- COLOR DIVERSITY IS CRITICAL: The colorHex of each cocktail must be genuinely derived from THIS person's specific quiz answers (their color preference in Q10, their personality, their mood, their flavor profile per principle 15). Do NOT default to orange/gold for everyone. Someone who chose green/teal should get a green cocktail, someone calm and creative gets blue/green, someone passionate gets red/orange, someone imaginative gets purple, someone fresh and bright gets yellow/lime, etc. Groups of friends will take this quiz together and compare results side by side. If everyone gets the same color, they will think the app is fake. The full rainbow is available: reds, oranges, yellows, greens, teals, blues, purples, pinks, magentas. Pick what truly fits the answers.
- The 3 cocktails for one person should also differ in color from each other, each reflecting a different facet of their personality, while all staying true to who they are.

AVAILABLE INGREDIENTS: ${ingredientList}${allergies && allergies.length > 0 && !allergies.includes("none") ? `

ALLERGY RESTRICTIONS \u2014 MUST AVOID: ${allergies.join(", ")}. Do NOT include any ingredient related to these restrictions in any of the 3 recipes.` : ""}`;
  const userPrompt = `Based on these quiz answers, create 3 personalised cocktail recipes for this person:

${answersText}

Return a JSON object with this exact structure:
{
  "flavorProfile": {
    "primaryFlavor": "sweet|sour|bitter|spicy|umami|salty",
    "secondaryFlavor": "sweet|sour|bitter|spicy|umami|salty",
    "personalityType": "one sentence describing their cocktail personality",
    "energyLevel": "low|medium|high",
    "adventureLevel": "classic|adventurous|wild",
    "socialStyle": "solo|intimate|social"
  },
  "recipes": [
    {
      "name": "Creative cocktail name",
      "tagline": "One punchy sentence that feels personal to them",
      "ingredients": [
        {"name": "exact ingredient name from available list", "amount": 45, "unit": "ml"},
        {"name": "another ingredient", "amount": 20, "unit": "ml"}
      ],
      "instructions": [
        "Step 1 instruction",
        "Step 2 instruction"
      ],
      "flavorNotes": ["flavor1", "flavor2", "flavor3"],
      "colorHex": "#hexcolor that represents this drink visually",
      "spiritBase": "the main spirit",
      "profileExplanation": "2-3 sentences explaining why this cocktail was made for them specifically, referencing their answers"
    }
  ]
}`;
  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "cocktail_recipes",
        strict: true,
        schema: {
          type: "object",
          properties: {
            flavorProfile: {
              type: "object",
              properties: {
                primaryFlavor: { type: "string" },
                secondaryFlavor: { type: "string" },
                personalityType: { type: "string" },
                energyLevel: { type: "string" },
                adventureLevel: { type: "string" },
                socialStyle: { type: "string" }
              },
              required: ["primaryFlavor", "secondaryFlavor", "personalityType", "energyLevel", "adventureLevel", "socialStyle"],
              additionalProperties: false
            },
            recipes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  tagline: { type: "string" },
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        amount: { type: "number" },
                        unit: { type: "string" }
                      },
                      required: ["name", "amount", "unit"],
                      additionalProperties: false
                    }
                  },
                  instructions: { type: "array", items: { type: "string" } },
                  flavorNotes: { type: "array", items: { type: "string" } },
                  colorHex: { type: "string" },
                  spiritBase: { type: "string" },
                  profileExplanation: { type: "string" }
                },
                required: ["name", "tagline", "ingredients", "instructions", "flavorNotes", "colorHex", "spiritBase", "profileExplanation"],
                additionalProperties: false
              }
            }
          },
          required: ["flavorProfile", "recipes"],
          additionalProperties: false
        }
      }
    }
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from Claude");
  let parsed;
  if (typeof content === "string") {
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[Claude] Raw response (first 500 chars):", cleaned.slice(0, 500));
      throw new Error(`Claude returned invalid JSON: ${e.message}`);
    }
  } else {
    parsed = content;
  }
  if (!parsed.recipes || parsed.recipes.length < 1) {
    throw new Error("Claude returned no recipes");
  }
  while (parsed.recipes.length < 3) {
    parsed.recipes.push({ ...parsed.recipes[0], name: `${parsed.recipes[0].name} Twist ${parsed.recipes.length + 1}` });
  }
  parsed.recipes = parsed.recipes.slice(0, 3);
  const availableNames = new Set(availableIngredients.map((i) => i.name.toLowerCase()));
  for (const recipe of parsed.recipes) {
    for (const ing of recipe.ingredients) {
      ing.unit = "ml";
    }
    recipe.ingredients = recipe.ingredients.filter((ing) => {
      const nameLower = ing.name.toLowerCase();
      return availableNames.has(nameLower) || Array.from(availableNames).some((n) => n.includes(nameLower) || nameLower.includes(n));
    });
    if (recipe.ingredients.length < 2 && availableIngredients.length >= 2) {
      recipe.ingredients = availableIngredients.slice(0, 3).map((i) => ({ name: i.name, amount: 45, unit: "ml" }));
    }
  }
  return parsed;
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  admin: router({
    login: publicProcedure.input(z2.object({ username: z2.string(), password: z2.string() })).mutation(({ input, ctx }) => {
      enforceRate(loginLimiter, clientIp(ctx));
      if (input.username.trim() !== ENV.adminUsername.trim() || input.password !== ENV.adminPassword.trim()) {
        throw new TRPCError2({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      const proto = ctx.req.headers["x-forwarded-proto"];
      const isHttps = ctx.req.protocol === "https" || (proto ? proto.split(",").some((p) => p.trim() === "https") : false) || ENV.isProduction;
      ctx.res.cookie(ADMIN_SESSION_KEY, "authenticated", {
        httpOnly: true,
        secure: isHttps,
        sameSite: "none",
        maxAge: 60 * 60 * 24 * 7,
        path: "/"
      });
      return { success: true };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(ADMIN_SESSION_KEY, { path: "/" });
      return { success: true };
    }),
    checkAuth: publicProcedure.query(({ ctx }) => {
      return { authenticated: isAdminSession(ctx) };
    }),
    getIngredients: publicProcedure.query(async ({ ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      return getAllIngredients();
    }),
    updateIngredient: publicProcedure.input(z2.object({ id: z2.number(), available: z2.boolean() })).mutation(async ({ input, ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      await updateIngredientAvailability(input.id, input.available);
      return { success: true };
    }),
    addIngredient: publicProcedure.input(z2.object({ name: z2.string().min(1), category: z2.string().min(1) })).mutation(async ({ input, ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      await addCustomIngredient({ name: input.name, category: input.category, available: true, isCustom: true });
      return { success: true };
    }),
    deleteIngredient: publicProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input, ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      await deleteIngredient(input.id);
      return { success: true };
    }),
    getSettings: publicProcedure.query(async ({ ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      return getAllAdminSettings();
    }),
    updateSetting: publicProcedure.input(z2.object({ key: z2.string(), value: z2.string() })).mutation(async ({ input, ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      await setAdminSetting(input.key, input.value);
      return { success: true };
    }),
    getSessions: publicProcedure.query(async ({ ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      return getAllQuizSessions();
    }),
    /**
     * Photo ingredient scanner — accepts a base64-encoded image (JPEG/PNG/WebP),
     * passes it to Claude vision, and returns a list of identified bar ingredients.
     * Images are NEVER stored; only Claude's text output is returned.
     */
    scanIngredientPhoto: publicProcedure.input(z2.object({
      imageBase64: z2.string().min(10)
      // base64 data URI, e.g. "data:image/jpeg;base64,..."
    })).mutation(async ({ input, ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError2({ code: "UNAUTHORIZED" });
      enforceRate(scanLimiter, clientIp(ctx));
      const response = await invokeLLM({
        model: "claude-haiku-4-5-20251001",
        messages: [
          {
            role: "system",
            content: `You are a professional bartender and ingredient identifier.
Your job is to look at photos of bar ingredients and identify exactly what they are.
Return a JSON object with a single key "ingredients" containing an array of identified ingredients.
Each item in the array must have:
- name: the specific ingredient name (e.g. "Hendricks Gin", "Fresh Mint", "Angostura Bitters", "Lime Juice")
- category: one of [spirits, liqueurs, mixers, juices, syrups, bitters, garnishes, other]
- confidence: "high", "medium", or "low"

Rules:
- Be specific. "Gin" is acceptable, but "Hendricks Gin" is better if you can tell.
- For fresh produce (mint, lime, lemon, etc.), use "garnishes" as category.
- If you see multiple ingredients in one photo, list all of them.
- If the image is unclear, still try your best and mark confidence as "low".
- Return ONLY the JSON object \u2014 no markdown, no extra text.`
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: input.imageBase64, detail: "high" }
              },
              {
                type: "text",
                text: "What bar ingredients do you see in this photo? Return only the JSON array."
              }
            ]
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ingredient_scan",
            strict: true,
            schema: {
              type: "object",
              properties: {
                ingredients: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      category: { type: "string", enum: ["spirits", "liqueurs", "mixers", "juices", "syrups", "bitters", "garnishes", "other"] },
                      confidence: { type: "string", enum: ["high", "medium", "low"] }
                    },
                    required: ["name", "category", "confidence"],
                    additionalProperties: false
                  }
                }
              },
              required: ["ingredients"],
              additionalProperties: false
            }
          }
        }
      });
      const raw = response.choices[0]?.message?.content ?? "{}";
      let parsed;
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        throw new TRPCError2({ code: "INTERNAL_SERVER_ERROR", message: "Could not parse Claude response" });
      }
      return { ingredients: parsed.ingredients ?? [] };
    })
  }),
  quiz: router({
    start: publicProcedure.input(z2.object({ guestName: z2.string().max(128).optional() })).mutation(async ({ input }) => {
      const sessionId = nanoid(16);
      await createQuizSession({
        sessionId,
        guestName: input.guestName ? sanitizeText(input.guestName) : null,
        answers: [],
        completed: false,
        webhookSent: false
      });
      return { sessionId };
    }),
    saveAnswer: publicProcedure.input(z2.object({
      sessionId: z2.string(),
      questionId: z2.number(),
      question: z2.string(),
      answer: z2.string()
    })).mutation(async ({ input }) => {
      const session = await getQuizSession(input.sessionId);
      if (!session) throw new TRPCError2({ code: "NOT_FOUND", message: "Session not found" });
      const answers = session.answers ?? [];
      const existingIndex = answers.findIndex((a) => a.questionId === input.questionId);
      if (existingIndex >= 0) {
        answers[existingIndex] = { questionId: input.questionId, question: input.question, answer: input.answer };
      } else {
        answers.push({ questionId: input.questionId, question: input.question, answer: input.answer });
      }
      await updateQuizSession(input.sessionId, { answers });
      return { success: true };
    }),
    generate: publicProcedure.input(z2.object({
      guestName: z2.string().max(128).optional(),
      answers: z2.array(z2.object({
        questionId: z2.number(),
        question: z2.string(),
        answer: z2.string()
      })).min(1).max(20),
      allergies: z2.array(z2.string()).optional()
    })).mutation(async ({ input, ctx }) => {
      enforceRate(generateLimiter, clientIp(ctx));
      const sessionId = nanoid(16);
      const guestName = input.guestName ? sanitizeText(input.guestName) : null;
      await createQuizSession({
        sessionId,
        guestName,
        answers: input.answers,
        completed: false,
        webhookSent: false
      });
      const availableIngredients = await getAvailableIngredients();
      const result = await generateCocktailWithClaude(input.answers, availableIngredients, input.allergies);
      await updateQuizSession(sessionId, {
        answers: input.answers,
        flavorProfile: result.flavorProfile,
        recipes: result.recipes,
        completed: true,
        webhookSent: false
      });
      runBackground(async () => {
        const ok = await deliverWebhook(
          WEBHOOK_URL,
          {
            event: "cocktail_quiz_completed",
            sessionId,
            guestName: guestName ?? "Guest",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            barName: "The Beast Bar",
            location: "Indonesia",
            flavorProfile: result.flavorProfile,
            recipes: result.recipes,
            quizAnswers: input.answers,
            whatsappNumber: "+32492532305"
          },
          { label: "quiz-webhook" }
        );
        if (ok) await updateQuizSession(sessionId, { webhookSent: true });
      });
      return { flavorProfile: result.flavorProfile, recipes: result.recipes, sessionId };
    }),
    getResult: publicProcedure.input(z2.object({ sessionId: z2.string() })).query(async ({ input }) => {
      const session = await getQuizSession(input.sessionId);
      if (!session || !session.completed) return null;
      return {
        flavorProfile: session.flavorProfile,
        recipes: session.recipes,
        guestName: session.guestName,
        sessionId: session.sessionId,
        orderSubmitted: session.orderSubmitted ?? false
      };
    }),
    submitOrder: publicProcedure.input(z2.object({
      sessionId: z2.string().min(8).max(64),
      email: z2.string().email().max(320),
      phone: z2.string().min(6).max(32).optional(),
      selectedRecipeIndex: z2.number().int().min(0).max(9).default(0),
      consentComms: z2.boolean(),
      consentDataSharing: z2.boolean(),
      consentFormVersion: z2.string().max(16),
      // Fallback copies of the result the client is already holding. Used to
      // reconstruct the session if its stored row is missing (e.g. evicted),
      // so an order can never silently fail to reach the bar.
      guestName: z2.string().max(128).optional(),
      recipes: z2.array(z2.unknown()).max(10).optional(),
      flavorProfile: z2.unknown().optional()
    })).mutation(async ({ input, ctx }) => {
      enforceRate(orderLimiter, clientIp(ctx));
      const existing = await getQuizSession(input.sessionId);
      if (existing?.orderSubmitted) {
        return { success: true, alreadySubmitted: true };
      }
      const recipes = existing?.recipes ?? input.recipes ?? null;
      const guestName = existing?.guestName ?? (input.guestName ? sanitizeText(input.guestName) : null);
      const flavorProfile = existing?.flavorProfile ?? input.flavorProfile ?? null;
      const answers = existing?.answers ?? [];
      if (!existing) {
        if (!recipes || recipes.length === 0) {
          throw new TRPCError2({ code: "NOT_FOUND", message: "Session not found" });
        }
        await createQuizSession({
          sessionId: input.sessionId,
          guestName,
          answers,
          flavorProfile,
          recipes,
          completed: true,
          webhookSent: false
        });
      }
      const consentIp = ctx.req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? ctx.req.socket?.remoteAddress ?? null;
      await updateQuizSession(input.sessionId, {
        orderEmail: input.email,
        orderPhone: input.phone,
        selectedRecipeIndex: input.selectedRecipeIndex,
        orderSubmitted: true,
        completed: true,
        consentComms: input.consentComms,
        consentDataSharing: input.consentDataSharing,
        consentFormVersion: input.consentFormVersion,
        consentIp: consentIp ?? void 0,
        consentTimestamp: /* @__PURE__ */ new Date()
      });
      const whatsappNumber = await getAdminSetting("whatsapp_number");
      const selectedRecipe = recipes?.[input.selectedRecipeIndex] ?? recipes?.[0];
      runBackground(
        () => deliverWebhook(
          WEBHOOK_URL,
          {
            event: "order_submitted",
            sessionId: input.sessionId,
            guestName,
            email: input.email,
            phone: input.phone,
            whatsappNumber,
            selectedRecipe,
            allRecipes: recipes,
            flavorProfile,
            quizAnswers: answers,
            submittedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          { label: "order-webhook" }
        )
      );
      return { success: true, alreadySubmitted: false };
    })
  }),
  public: router({
    getReviews: publicProcedure.query(async () => {
      return getAllReviews();
    })
  })
});

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/storageProxy.ts
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
function registerStorageProxy(app2) {
  app2.get("/storage/:key(*)", async (req, res) => {
    const key = req.params.key;
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.s3Endpoint || !ENV.s3AccessKey || !ENV.s3SecretKey || !ENV.s3Bucket) {
      res.status(500).send("Storage not configured");
      return;
    }
    try {
      const s3 = new S3Client({
        endpoint: ENV.s3Endpoint,
        region: ENV.s3Region || "eu-central",
        credentials: {
          accessKeyId: ENV.s3AccessKey,
          secretAccessKey: ENV.s3SecretKey
        },
        forcePathStyle: true
      });
      const command = new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key });
      const url = await getSignedUrl(s3, command, { expiresIn: 300 });
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage error");
    }
  });
}

// api/index.ts
var app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.get("/api/health", async (_req, res) => {
  try {
    const status = await getDbStatus();
    res.status(status.ok ? 200 : 503).json({
      status: status.ok ? "ok" : "degraded",
      ...status,
      time: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://maps.googleapis.com",
      "frame-ancestors 'none'"
    ].join("; ")
  );
  next();
});
var FILE_LIKE_PATHS = [
  "/robots.txt",
  "/sitemap.xml",
  "/.well-known/security.txt",
  "/.well-known/ai-plugin.json",
  "/openapi.json",
  "/manifest.json"
];
app.get(FILE_LIKE_PATHS, (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
registerStorageProxy(app);
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error("[tRPC]", error);
      }
    }
  })
);
var index_default = app;
export {
  index_default as default
};
