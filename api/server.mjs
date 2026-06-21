// THIS FILE IS A PLACEHOLDER — overwritten by `node scripts/build-api.mjs` during Vercel build.
// Do not edit. See scripts/build-api.mjs for the real bundle logic.
import express from "express";
const app = express();
app.use((_req, res) => res.status(503).json({ error: "not built yet" }));
export default app;
