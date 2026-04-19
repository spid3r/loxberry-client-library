/**
 * Path-filtered semantic-release for `loxberry-client-mcp` only (via multi-semantic-release).
 * Skips publishing when no commits touched `packages/loxberry-client-mcp/`.
 * @see https://github.com/dhoulb/multi-semantic-release
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// multi-semantic-release uses CJS require() against semantic-release, which is ESM-only from v20+.
// Unwrap `module.exports.default` to the default export before semrel.js caches the namespace object.
function unwrapEsmDefaultForCjs(moduleId) {
  let resolved;
  try {
    resolved = require.resolve(moduleId);
  } catch {
    return;
  }
  const mod = require(resolved);
  if (mod?.__esModule && mod.default !== undefined) {
    require.cache[resolved].exports = mod.default;
  }
}

unwrapEsmDefaultForCjs("semantic-release/lib/get-config");
unwrapEsmDefaultForCjs("semantic-release");

// Use package root (exports "."); subpaths under lib/ are not exported.
const multiSemanticRelease = require("multi-semantic-release");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = {
  deps: { bump: "override", release: "patch", prefix: "" },
  dryRun: process.argv.includes("--dry-run"),
  debug: process.argv.includes("--debug"),
};

const packages = await multiSemanticRelease(
  [path.join(root, "packages/loxberry-client-mcp/package.json")],
  {},
  { cwd: root, env: process.env, stdout: process.stdout, stderr: process.stderr },
  flags,
);

const released = packages.filter((p) => p.result && p.result !== false).length;
if (released === 0) {
  console.log(
    "[release-mcp] No MCP release (no commits under packages/loxberry-client-mcp/, or nothing to publish).",
  );
}
