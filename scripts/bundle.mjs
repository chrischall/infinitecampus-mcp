import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["dotenv"],
  // Cheap insurance, not a diagnosis: alltrails-mcp#119 shipped a standalone
  // bundle whose Zod failed to initialise without this alias. It has not been
  // observed to bite here — a control bundle built without it serves the full
  // tool list — but the break it guards is runtime-only and version-sensitive.
  alias: { "zod/v4": "./node_modules/zod/v4/index.cjs" },
  banner: {
    js: 'import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);',
  },
  outfile: "dist/bundle.js",
});
