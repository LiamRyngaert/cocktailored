import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

// Lazy-initialize heavy modules so init errors are visible in the response
let _initPromise: Promise<void> | null = null;
let _initError: unknown = null;
let _initialized = false;

async function initialize(): Promise<void> {
  try {
    const [
      { createExpressMiddleware },
      { appRouter },
      { createContext },
      { registerStorageProxy },
    ] = await Promise.all([
      import("@trpc/server/adapters/express"),
      import("../server/routers"),
      import("../server/_core/context"),
      import("../server/_core/storageProxy"),
    ]);

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
        },
      })
    );
  } catch (e) {
    _initError = e;
    throw e;
  } finally {
    _initialized = true;
  }
}

app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!_initPromise) _initPromise = initialize();
  try {
    await _initPromise;
    next();
  } catch (_e) {
    const err = _initError as any;
    // Return the full error so we can diagnose ERR_MODULE_NOT_FOUND
    res.status(500).json({
      initError: true,
      code: err?.code ?? "UNKNOWN",
      message: err?.message ?? String(err),
      requireStack: err?.requireStack ?? [],
    });
  }
});

export default app;
