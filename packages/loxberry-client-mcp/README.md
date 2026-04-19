# loxberry-client-mcp

stdio [Model Context Protocol](https://modelcontextprotocol.io) server that exposes LoxBerry plugin and JSON-RPC operations as tools.

## Setup

Set environment variables (same as the main CLI):

- `LOXBERRY_BASE_URL` — e.g. `https://loxberry.local`
- `LOXBERRY_USERNAME` / `LOXBERRY_PASSWORD` — when admin login is required
- If `/admin` is behind **HTTP Basic Auth**: `LOXBERRY_HTTP_BASIC_USERNAME` / `LOXBERRY_HTTP_BASIC_PASSWORD`, or `LOXBERRY_HTTP_BASIC_SAME=1` to reuse the web UI credentials (same as the main library README).

## Run

### From a git clone (development)

After `npm run build:all` at the monorepo root:

```bash
node packages/loxberry-client-mcp/dist/server.js
```

### After `npm install` (local or CI)

The package declares a **`bin`**: `loxberry-client-mcp` → `dist/server.js`. You do **not** need a long `node …/dist/server.js` path if the package is installed and its `node_modules/.bin` is on your `PATH`:

```bash
npx loxberry-client-mcp
```

```bash
npm install -g loxberry-client-mcp
loxberry-client-mcp
```

(`-g` puts the shim on your global PATH; same idea as `npx` but persistent.)

### Cursor / VS Code `mcp.json`

**1. Local clone (absolute path to `server.js`)** — valid; use **forward slashes** in JSON on Windows if you like, or escape backslashes (`\\`). **You should pass LoxBerry settings via `env`** so the process does not rely on a shell-loaded `.env`:

```json
{
  "mcpServers": {
    "loxberry-client-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/Github/loxberry-client-library/packages/loxberry-client-mcp/dist/server.js"],
      "env": {
        "LOXBERRY_BASE_URL": "https://loxberry.local",
        "LOXBERRY_USERNAME": "admin",
        "LOXBERRY_PASSWORD": "your-password",
        "LOXBERRY_SECURE_PIN": "your-secure-pin",
      }
    }
  }
}
```

**2. After installing from npm** — use the **published binary name** (no path to `dist/`):

```json
{
  "mcpServers": {
    "loxberry-client-mcp": {
      "type": "stdio",
      "command": "loxberry-client-mcp",
      "args": [],
      "env": {
        "LOXBERRY_BASE_URL": "https://loxberry.local",
        "LOXBERRY_USERNAME": "admin",
        "LOXBERRY_PASSWORD": "your-password"
      }
    }
  }
}
```

If the global shim is not on the PATH Cursor sees, use the full path to the shim (e.g. `%AppData%\\npm\\loxberry-client-mcp.cmd` on Windows) or `npx`:

```json
"command": "npx",
"args": ["-y", "loxberry-client-mcp"]
```

(`-y` accepts the install prompt for `npx`; still set `env` as above.)

### Automated smoke (monorepo)

From the repo root, after `npm run build:all`:

```bash
npm run test:mcp
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node packages/loxberry-client-mcp/dist/server.js
```

## Tools

Each tool includes [MCP tool annotations](https://modelcontextprotocol.io) (`readOnlyHint`, `destructiveHint`, …) so clients can badge or gate calls. That is **not** a guarantee of safety (hints are advisory). For uninstall we also require an explicit confirmation string (see below).

- `plugins_list` — read-only list (annotations: read-only).
- `plugins_upload` — `{ filePath, securePin?, followInstallLog?, installTimeoutMs?, logTailChars? }` — installs a plugin; after upload, follows the per-upload tempfile log by default and returns JSON (`status`, `summary`, `logTail`), not raw HTML. Set `followInstallLog: false` for upload-only metadata plus a short response preview.
- `plugins_uninstall` — `{ pluginId, confirmPhrase, includeHtmlPreview? }` — **`confirmPhrase` must be exactly `UNINSTALL_CONFIRMED`**. `pluginId` is matched against **`plugins_list`** (md5, folder, or name); if nothing matches, **no** uninstall HTTP is sent (`status: not_installed`). If it matches, uninstall runs and the tool **re-lists** plugins so `status: success` means the row is actually gone (LoxBerry HTML alone is unreliable). Raw HTML only with `includeHtmlPreview: true`. Marked **destructive** in annotations.
- `logs_install` — `{ follow?: boolean }` — read install log (read-only).
- `jsonrpc_call` — `{ method, params? }` (`params` is a JSON string) — arbitrary JSON-RPC; use read-only methods when exploring.

## Publishing

This package is published separately from **`loxberry-client-library`**. Before the first npm publish, set the dependency to a **semver range** of the published core package (not `file:../..`). See [RELEASING.md](../../RELEASING.md).
