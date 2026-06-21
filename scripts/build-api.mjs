import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(root, "api/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(root, "api/server.cjs"),
  // Only node_modules are external — all local server/shared code gets inlined
  packages: "external",
  tsconfig: resolve(root, "tsconfig.json"),
  logLevel: "info",
});

console.log("✓ API bundle written to api/server.cjs");
