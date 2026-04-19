/**
 * Path-filtered semantic-release for `loxberry-client-mcp` only (via multi-semantic-release).
 * Skips publishing when no commits touched `packages/loxberry-client-mcp/`.
 * @see https://github.com/dhoulb/multi-semantic-release
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const multiSemanticRelease = require("multi-semantic-release/lib/multiSemanticRelease.js");

const root = path.dirname(fileURLToPath(new URL("..", import.meta.url)));
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
