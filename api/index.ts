import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import { registerStorageProxy } from "../server/_core/storageProxy";
import { getDbStatus } from "../server/db";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check for uptime monitors / load balancers. Returns 200 when the
// backend is linked to a durable database, 503 when the database is down so an
// external monitor can alert. Never throws.
app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    const status = await getDbStatus();
    res.status(status.ok ? 200 : 503).json({
      status: status.ok ? "ok" : "degraded",
      ...status,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: "error", error: (err as Error).message });
  }
});

// Security headers for API responses
app.use((_req: Request, res: Response, next: NextFunction) => {
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
      "frame-ancestors 'none'",
    ].join("; ")
  );
  next();
});

// Static file-like paths that should 404, not return SPA HTML (CSC-002)
const FILE_LIKE_PATHS = [
  "/robots.txt",
  "/sitemap.xml",
  "/.well-known/security.txt",
  "/.well-known/ai-plugin.json",
  "/openapi.json",
  "/manifest.json",
];
app.get(FILE_LIKE_PATHS, (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

registerStorageProxy(app);

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error }) {
      // Suppress internal error details from public responses (CSC-003)
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error("[tRPC]", error);
      }
    },
  })
);

export default app;
