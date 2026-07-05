import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { logError, logInfo, requestId } from "./reliability";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Never leak internal error details (stack traces, DB messages) to clients.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return { ...shape, message: "Internal server error" };
    }
    return shape;
  },
});

export const router = t.router;

// Observe every call: tag it with a request id, time it, and log failures and
// slow procedures as structured JSON for tracing in the Vercel logs.
const observability = t.middleware(async ({ path, type, next }) => {
  const id = requestId();
  const start = Date.now();
  const res = await next();
  const ms = Date.now() - start;
  if (!res.ok) {
    logError("trpc", "procedure failed", { id, path, type, ms, code: res.error.code });
  } else if (ms > 1_000) {
    logInfo("trpc", "slow procedure", { id, path, type, ms });
  }
  return res;
});

export const publicProcedure = t.procedure.use(observability);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireUser);

export const adminProcedure = publicProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
