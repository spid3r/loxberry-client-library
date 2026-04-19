# Contributing

## Monorepo layout

- **Root** [`package.json`](package.json): **`loxberry-client-library`** — core library, CLI, tests, and tooling.
- **Workspace** [`packages/loxberry-client-mcp`](packages/loxberry-client-mcp): **`loxberry-client-mcp`** — MCP server package; depends on **`loxberry-client-library`** from the registry (semver). Released on its own schedule when commits touch that directory ([RELEASING.md](RELEASING.md)).
- **npm workspaces** (`"workspaces": ["packages/*"]`) wire local `npm run build -w …` and workspace installs; published tarballs are separate npm packages.

## Dependency hygiene

The published **loxberry-client-library** tarball has no runtime **dependencies** (consumers get only `dist/` + docs).

### “Future proof” without constant churn

- **`package-lock.json`** is the reproducible snapshot: commit it, use **`npm ci`** in CI (already do).
- **Root `overrides`**: [`package.json`](package.json) pins patched transitive versions (e.g. **`diff`**, **`serialize-javascript`**, **`picomatch`**, **`brace-expansion`**) so **`npm audit`** stays clean for normal contributor installs. Update these when advisories change.
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

**Semantic-release**, its publish plugins, and **multi-semantic-release** are **not** root devDependencies: the [Release workflow](.github/workflows/release.yml) installs them with `npm install --no-save` so **`npm ci`** does not pull the full release stack (including the **`npm`** CLI subtree used by **`@semantic-release/npm`**). The **`npm run release:mcp`** script installs **multi-semantic-release** the same way before running [`scripts/release-mcp.mjs`](scripts/release-mcp.mjs). To dry-run releases locally:

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

**`scope: mcp`:** The root package’s release analyzer treats **`feat(mcp):`**, **`fix(mcp):`**, etc. as **no version bump for `loxberry-client-library`** — MCP releases are handled by a **separate** [`multi-semantic-release`](https://github.com/dhoulb/multi-semantic-release) step that only considers commits touching `packages/loxberry-client-mcp/`. Use **`feat:`** / **`fix:`** without the `mcp` scope for changes to the core library.

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

The [Release workflow](.github/workflows/release.yml) runs **`semantic-release`** for the core library, then **`node scripts/release-mcp.mjs`** ([multi-semantic-release](https://github.com/dhoulb/multi-semantic-release)) for **`loxberry-client-mcp`** when commits touch that folder. Consumers can **`npm install -g loxberry-client-mcp`**; it depends on **`loxberry-client-library`** from the registry via semver. See [RELEASING.md](RELEASING.md).
