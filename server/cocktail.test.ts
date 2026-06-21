import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { cookie: "" },
    } as TrpcContext["req"],
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

describe("quiz.start", () => {
  it("creates a new quiz session and returns a sessionId", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.quiz.start({ guestName: "Test User" });
    expect(result).toHaveProperty("sessionId");
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId.length).toBeGreaterThan(0);
  });
});

describe("public.getReviews", () => {
  it("returns an array of reviews", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const reviews = await caller.public.getReviews();
    expect(Array.isArray(reviews)).toBe(true);
    if (reviews.length > 0) {
      expect(reviews[0]).toHaveProperty("name");
      expect(reviews[0]).toHaveProperty("text");
      expect(reviews[0]).toHaveProperty("rating");
    }
  });
});

describe("admin.checkAuth", () => {
  it("returns not authenticated for a public context", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.checkAuth();
    expect(result.authenticated).toBe(false);
  });
});

describe("admin.login", () => {
  it("rejects wrong credentials", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.login({ username: "wrong", password: "wrong" })).rejects.toThrow();
  });
});
