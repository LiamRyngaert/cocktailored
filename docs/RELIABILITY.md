# Backend reliability & scaling guide

This app runs on Vercel serverless functions. This document explains how the
backend is made reliable, how to verify it is healthy, and what is required to
serve a very large number of concurrent users without breaking.

## The core rule: you MUST configure `DATABASE_URL`

The backend uses MySQL (via Drizzle). If `DATABASE_URL` is **not** set, it falls
back to an **in-memory store**. That fallback is fine for local development but
is *fatal in production*, because:

- Vercel runs many short-lived, isolated serverless instances.
- They do **not** share memory.
- So an order written on instance A is invisible to instance B — orders
  "disappear", never reach the admin, and ingredient toggles jump back.

**This single missing variable explains most "it randomly breaks" symptoms.**

To go live:

1. Set `DATABASE_URL` in the Vercel project (Settings → Environment Variables),
   for **Production, Preview and Development**.
2. Run the migrations: `pnpm db:push`.
3. Redeploy and confirm the health check (below) reports `database`.

## What makes it reliable (already in the code)

All reliability primitives live in `server/_core/reliability.ts` and are wired
through the database layer, tRPC layer and routers.

- **Cached connection pool** (`server/db.ts`): one small `mysql2` pool per
  instance, cached on `globalThis`, so warm invocations reuse connections
  instead of opening a new one per request. Prevents connection exhaustion and
  "server has gone away" errors under load.
- **Automatic retry with jittered backoff** on transient connection errors and
  timeouts — a dropped connection is replaced and the query retried, so a blip
  never surfaces as a user error.
- **Query timeouts**: every DB query is time-boxed (`DB_QUERY_TIMEOUT_MS`), so a
  single stuck connection can never hang a request.
- **Circuit breaker**: after repeated DB failures the breaker opens for a short
  cooldown — requests fail fast (and cached reads still serve) instead of
  piling onto a struggling database, then it half-opens to probe recovery.
- **Read caching** (short-TTL, per instance): reviews, ingredient lists and
  settings are cached so a spike of concurrent users doesn't become a matching
  spike of DB queries. Writes invalidate the relevant cache.
- **Fluid Compute pool draining**: the pool registers with `attachDatabasePool`
  so idle connections drain before an instance suspends (best-effort).
- **Per-IP rate limiting** (token bucket) on the expensive endpoints
  (`generate`, photo `scan`, admin `login`, `submitOrder`) — caps abuse and
  floods while staying generous enough for a whole venue behind one IP.
- **Robust, non-blocking webhooks**: order/quiz notifications are delivered in
  the background (Vercel `waitUntil`) with per-attempt timeouts and retrying
  backoff, so webhook latency never delays the guest and a flaky endpoint is
  retried. The order is persisted first, so it reaches the admin regardless.
- **Resilient LLM calls** (`server/_core/llm.ts`): each Claude call is
  time-boxed and auto-retried on 429/5xx/network errors with backoff.
- **Order write is loss-proof** (`submitOrder`): if the stored session row is
  ever missing, the order is rebuilt from the client's data and upserted instead
  of failing with `NOT_FOUND`. Idempotent, so a double click never errors.
- **Structured logging + safe errors** (`server/_core/trpc.ts`): every call is
  tagged with a request id, timed, and failures/slow calls are logged as JSON;
  internal error details are never leaked to clients.
- **Bounded memory**: the dev in-memory fallback, rate-limiter buckets and
  caches all evict old entries so nothing grows unbounded.
- **Database indexes** (`drizzle/schema.ts`): on `quiz_sessions(createdAt,
  orderSubmitted)` and `ingredients(available, category)` for fast reads at
  scale. Apply them with `pnpm db:push`.

## Health monitoring — "is it still linked?"

Two ways to check the backend link at any time:

1. **HTTP endpoint** `GET /api/health` — returns `200` with
   `{ "status": "ok", "mode": "database", "latencyMs": N }` when linked, or
   `503` when the database is unreachable. Point any uptime monitor
   (UptimeRobot, Better Stack, Pingdom, Vercel Monitoring) at it and get alerted
   the moment the link drops.
2. **Admin dashboard** → *Instellingen* shows a live "Backend status" widget
   that polls every 20 seconds and turns:
   - 🟢 green — connected to the database (with latency),
   - 🟠 amber — running on in-memory storage (NOT safe — set `DATABASE_URL`),
   - 🔴 red — database unreachable.

## Scaling to ~100,000 concurrent users

Concurrency at that level is bounded by the **database connection limit**, not by
Vercel. Total connections ≈ `live instances × DB_POOL_SIZE`. A single MySQL
server (e.g. Hetzner) typically allows only a few hundred connections, so it
cannot directly absorb that many concurrent functions. Pick one of:

- **Serverless MySQL — PlanetScale (recommended).** It fronts the database with
  its own pooler and an HTTP driver, removing the per-connection ceiling. Drizzle
  supports it via `drizzle-orm/planetscale-serverless`. This is the least-effort
  path to massive concurrency and keeps the existing MySQL schema.
- **A connection pooler in front of your own MySQL** (ProxySQL / a managed
  pooler). Keep `DB_POOL_SIZE` small (e.g. 4–8) so the pooler, not the database,
  absorbs the fan-out.
- **Tune `DB_POOL_SIZE`** to match your database's `max_connections` divided by a
  safe estimate of peak concurrent instances.

Also recommended for large traffic:

- Enable **Vercel Fluid Compute** (better connection reuse; already supported by
  the code).
- Cache read-heavy public endpoints (e.g. reviews) at the edge.
- Keep the AI generation on a fast model and consider a queue if generation
  latency becomes a bottleneck under peak load.

## Quick checklist before a big launch

- [ ] `DATABASE_URL` set in Vercel (Production + Preview) and migrations applied.
- [ ] `GET /api/health` returns `mode: "database"`.
- [ ] Admin "Backend status" widget is green.
- [ ] Uptime monitor pointed at `/api/health`.
- [ ] Using PlanetScale (or a pooler) if you expect tens of thousands concurrent.
- [ ] `DB_POOL_SIZE` tuned to the database's connection limit.
