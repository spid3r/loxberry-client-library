import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      mqtt: "src/mqtt.ts",
    },
    format: ["cjs", "esm"],
    dts: {
      entry: { index: "src/index.ts", mqtt: "src/mqtt.ts" },
      // tsup’s DTS worker injects deprecated `baseUrl` (TS 6); keep silence here so root `tsconfig.json` stays schema-clean for the IDE.
      compilerOptions: { ignoreDeprecations: "6.0" },
    },
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
