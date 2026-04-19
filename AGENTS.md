# Agent notes (LoxBerry client library)

Concise context for coding agents working in this repo. Authoritative details live in [`README.md`](README.md) and [`RELEASING.md`](RELEASING.md).

## Purpose

TypeScript client for **LoxBerry 3.x**: JSON-RPC (`/admin/system/jsonrpc.php`), plugin admin HTTP aligned with stock **`plugininstall.cgi`**, optional **`fetchMqttConnectionDetails`** (JSON-RPC only, no MQTT npm client in-tree), **`loxberry-client`** CLI, optional **`loxberry-client-mcp`** stdio MCP server.

Target users: **plugin developers** automating test/deploy against a real or mocked appliance.

## Auth

- Stock images: **`/admin`** is **HTTP Basic** (Apache `htmlauth`). Default client strategy **`basic`** sends the same user/password as the browser on every request.
- Optional **HTML form** login: `LOXBERRY_AUTH_STRATEGY=form` and `LOXBERRY_LOGIN_PATH` if the deployment differs.
- Separate Basic credentials: `LOXBERRY_HTTP_BASIC_*` or `LOXBERRY_HTTP_BASIC_SAME=1`.

## Plugin install flow (important)

1. **Upload** POST to `plugininstall.cgi` with multipart zip + **SecurePIN** (`LOXBERRY_SECURE_PIN` / option).
2. Response HTML contains a **temp** log path; stock UI polls **`logfile.cgi?logfile=….log`**. The library exposes **`followPluginInstallTempLog()`** (and helpers to extract the tempfile from HTML). **Do not** rely only on **`waitForPluginFolder`** right after upload without following that log when automating installs.
3. **`plugininstall.pl`** expects **`icons/`** in the zip (e.g. `icon_64.png`); missing icons can break install. E2E fixture includes minimal PNGs.

## CLI reference source of truth

- [`src/cli-reference.ts`](src/cli-reference.ts) drives console help (`formatCliHelpText`) and README tables (`formatCliReferenceMarkdown`).
- Regenerate README: `npm run docs:sync-cli` (markers `<!-- CLI_REFERENCE_START/END -->` in `README.md`).

## Tests

- **`npm test`**: mock/fixture tests only; no LoxBerry required.
- **`npm run test:live*`** scripts: gated by `LOXBERRY_LIVE_TESTS=1`; need `.env` at repo root (loaded by `test/helpers/load-env-file.ts`, not `dotenv`), with base URL, credentials, and for upload tests **`LOXBERRY_SECURE_PIN`**.
- Debug artifacts: `tmp/loxberry-live-debug/` when `LOXBERRY_LIVE_DEBUG=1`.

## MCP package

- Path: `packages/loxberry-client-mcp`, binary **`loxberry-client-mcp`**, server metadata name **`loxberry-client-mcp`**.
- Build: `npm run build:all`. Smoke: `npx @modelcontextprotocol/inspector node packages/loxberry-client-mcp/dist/server.js`.
- Depends on **`loxberry-client-library`** via semver in `package.json`; see `RELEASING.md`.

## Release

- Root: semantic-release on `main`; **`GITHUB_TOKEN`** for git push + GitHub Release; npm publish via **[trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/)** on workflow **`release.yml`** (preferred) or optional **`NPM_TOKEN`**. See `RELEASING.md`.
- Conventional commits enforced on PRs via commitlint (see `CONTRIBUTING.md`).
- MCP smoke: `npm run test:mcp` after build.
- MCP npm package: released by `scripts/release-mcp.mjs` (multi-semantic-release) after the core library step; see `RELEASING.md`.
