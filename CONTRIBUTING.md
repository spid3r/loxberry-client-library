# Contributing

## Dependency hygiene

The published **loxberry-client-library** tarball has no runtime **dependencies** (consumers get only `dist/` + docs).

### “Future proof” without constant churn

- **`package-lock.json`** is the reproducible snapshot: commit it, use **`npm ci`** in CI (already do).
- **Ranges in `package.json`**: we use **`~`** on **TypeScript** (`~6.0.x`) so you get **patch** fixes within the 6.0 line without automatic minors. Other tools use **`^`** where semver breakage is rarer; adjust if you want stricter pins.
- **Declarations**: **`npm run build`** runs **`tsc --emitDeclarationOnly -p tsconfig.dts.json`** after **tsup** so `.d.ts` files come from the official compiler, not from tsup’s DTS worker (that worker injects deprecated `baseUrl` on TypeScript 6+ — [egoist/tsup#1388](https://github.com/egoist/tsup/issues/1388)). No `ignoreDeprecations` workarounds.
- **“Latest” everywhere** (`npm update` to absolute newest majors) is optional and high-touch; run **`npm outdated`** occasionally and upgrade on your schedule.

Every **`devDependencies`** entry exists for a concrete reason:

| Package | Why it is here |
|--------|----------------|
| `typescript` (`~6.0.x`) / `tsup` | **tsup** bundles JS (ESM/CJS/IIFE/CLI); **`tsconfig.dts.json`** + `tsc --emitDeclarationOnly` emits types (see row above). |
| `tsx` | Run tests and small scripts without a separate compile step. |
| `mocha` / `@types/mocha` | Unit tests. |
| `@types/node` | Typings for Node APIs. |
| `undici` | `MockAgent` in tests; tests must use `fetch` from `undici` (see `test/helpers/undici-fetch.ts`) so mocks apply — Node’s `globalThis.fetch` does not always share that dispatcher. |
| `jszip` | Live E2E zip assembly + `scripts/build-e2e-plugin-zip.ts`. |
| `cross-env` | `test:live*` scripts set env vars on Windows and Unix. |
| `@commitlint/cli` / `@commitlint/config-conventional` | Enforce commit messages on pull requests (CI). |

**Semantic-release** and its publish plugins are **not** root devDependencies: the [Release workflow](.github/workflows/release.yml) installs them with `npm install --no-save` so day-to-day `npm ci` stays smaller. To dry-run a release locally:

```bash
npm run release:dry-run
```

## Conventional commits

Use [Conventional Commits](https://www.conventionalcommits.org/) so [semantic-release](https://semantic-release.gitbook.io/) can pick versions and write [CHANGELOG.md](CHANGELOG.md):

| Prefix | Release impact (typical) |
|--------|---------------------------|
| `fix:` | Patch |
| `feat:` | Minor |
| `feat!:` or `BREAKING CHANGE:` in footer | Major |
| `docs:`, `chore:`, `ci:`, `test:` | Often no release (see analyzer defaults) |

Merge commits from GitHub are ignored by [commitlint.config.cjs](commitlint.config.cjs).

On a branch, after `git fetch origin`, you can check messages with:

```bash
npm run lint:commits
```

CI runs commitlint on **pull requests** only (commit range `base…head`).

## MCP package smoke test

Requires `packages/loxberry-client-mcp/dist/server.js` (run `npm run build:mcp` or `build:all` first):

```bash
npm run test:mcp
```

This uses the official SDK client over stdio to call **`tools/list`**; it does not call your real LoxBerry.

## Publishing `loxberry-client-mcp` for others

Today only **`loxberry-client-library`** is released by the workflow on npm. Others can still use the MCP server by:

1. **Clone + workspace**: `npm install` at repo root, `npm run build:all`, point Cursor at `packages/loxberry-client-mcp/dist/server.js`.
2. **Future npm package `loxberry-client-mcp`**: change its dependency from `file:../..` to a published semver on `loxberry-client-library`, then `npm publish -w loxberry-client-mcp --access public` (manually or a second workflow). See [RELEASING.md](RELEASING.md).
