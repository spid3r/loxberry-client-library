import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      mqtt: "src/mqtt.ts",
    },
    format: ["cjs", "esm"],
    dts: false,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    outExtension({ format }) {
      return { js: format === "esm" ? ".js" : ".cjs" };
    },
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["cjs"],
    sourcemap: true,
    treeshake: true,
    outDir: "dist",
    outExtension: () => ({ js: ".cjs" }),
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: { "loxberry-client.browser": "src/global.ts" },
    format: ["iife"],
    globalName: "LoxBerryClient",
    sourcemap: true,
    treeshake: true,
    clean: false,
  },
]);
