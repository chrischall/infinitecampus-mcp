import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["dotenv"],
  // ws's optional native addons (bufferutil, utf-8-validate) are not
  // dependencies and are never shipped, so its `require` of them always
  // fails. Defining the opt-outs drops that dead branch — and the two env
  // reads that would otherwise look like server configuration.
  define: {
    "process.env.WS_NO_BUFFER_UTIL": "true",
    "process.env.WS_NO_UTF_8_VALIDATE": "true",
  },
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
