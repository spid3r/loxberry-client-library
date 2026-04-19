/**
 * Spawns the built stdio server:
 * 1) `tools/list` — no LoxBerry network.
 * 2) `tools/call` → `plugins_list` — hits a dead port; asserts we get an error path (proves MCP tool execution works).
 */
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(testDir, "..");
const serverJs = join(pkgRoot, "dist", "server.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverJs],
  cwd: pkgRoot,
  env: {
    ...process.env,
    LOXBERRY_BASE_URL: "http://127.0.0.1:9",
  },
  stderr: "inherit",
});

const client = new Client({ name: "loxberry-client-mcp-smoke", version: "0.0.0" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
const names = new Set((tools ?? []).map((t) => t.name));
for (const need of [
  "plugins_list",
  "plugins_upload",
  "plugins_uninstall",
  "logs_install",
  "jsonrpc_call",
]) {
  assert.ok(names.has(need), `expected tool ${need}, got ${[...names].sort().join(", ")}`);
}

/** Dead port: list plugins should fail inside the tool (or throw), not hang forever. */
try {
  const invoked = await client.callTool({ name: "plugins_list", arguments: {} });
  const blob = JSON.stringify(invoked);
  const looksLikeFailure =
    invoked &&
    typeof invoked === "object" &&
    "isError" in invoked &&
    invoked.isError === true;
  const textBits = blob.toLowerCase();
  const messageLikelyNetworkError =
    /econnrefused|fetch failed|network|aggregateerror|socket|undici/i.test(textBits) ||
    /error|failed/i.test(
      typeof invoked === "object" && invoked !== null && "content" in invoked
        ? JSON.stringify((invoked as { content?: unknown }).content)
        : blob,
    );
  assert.ok(
    looksLikeFailure || messageLikelyNetworkError,
    `expected plugins_list to fail against 127.0.0.1:9; got: ${blob.slice(0, 600)}`,
  );
} catch (err) {
  assert.match(String(err), /ECONNREFUSED|fetch|network|aggregate|socket/i);
}

/** plugins_uninstall must refuse calls without confirmPhrase (literal UNINSTALL_CONFIRMED). */
const uninstallNoConfirm = await client.callTool({
  name: "plugins_uninstall",
  arguments: { pluginId: "would-not-be-called" },
});
assert.equal(uninstallNoConfirm.isError, true, "plugins_uninstall without confirmPhrase must fail validation");
const uninstallBlob = JSON.stringify(uninstallNoConfirm);
assert.match(
  uninstallBlob,
  /confirmPhrase|UNINSTALL_CONFIRMED|validation|Invalid arguments/i,
  "expected validation error mentioning confirmPhrase",
);

await client.close();
console.log(
  "loxberry-client-mcp smoke: tools/list + tools/call (plugins_list → expected failure) OK (%d tools)",
  tools?.length ?? 0,
);

