# Releasing

## First push checklist (GitHub + npm)

Use this when the repo is new or you are wiring CI and npm for the first time.

1. **Canonical GitHub remote** — `package.json` → `repository.url` must point at the **real** repo you will publish from (correct org/user and repo name). Forks should change this before expecting npm provenance or `@semantic-release/github` to match.

2. **Branch** — Default branch should be **`main`** (matches [`.releaserc.json`](.releaserc.json) and the workflows).

3. **npm account + first-time package** — Sign in at [npmjs.com](https://www.npmjs.com/) (2FA recommended). Confirm the name **`loxberry-client-library`** is not taken. Trusted publishing is configured under **each package’s** settings, so the package must **exist** before you can attach GitHub Actions OIDC to it. Typical first-time flow:

   - **Create the package once** (pick one):
     - **A.** Locally: `npm run build`, then `npm publish --access public` while logged in with `npm login` (creates the package under your account), **or**
     - **B.** Add a GitHub repo secret **`NPM_TOKEN`** (automation token with publish rights) and let the first successful **`release.yml`** run on `main` run `semantic-release` / `npm publish` (also creates the package).
   - Then open **npm → Packages → `loxberry-client-library` → Settings → Trusted publishing → GitHub Actions**: repository **`spid3r/loxberry-client-library`** (or your canonical owner), workflow file **`release.yml`**. Save.
   - After OIDC publishes work, remove **`NPM_TOKEN`** if you added it, and under **Publishing access** consider requiring 2FA and disallowing classic tokens ([npm docs](https://docs.npmjs.com/trusted-publishers/)).

   If the package **already exists** and you own it, skip straight to **Trusted publishing** and match **`release.yml`** exactly.

4. **Local gate before you push or merge to `main`** (from repo root):

   ```bash
   npm ci
   npm run typecheck:test
   npm test
   npm run docs:sync-cli
   git diff --exit-code README.md
   npm run build:all
   npm run test:mcp
   npm run release:dry-run
   ```

   The dry run shows whether semantic-release would cut a release from **current git history** and **does not** publish, tag, or push. If there is no `fix:` / `feat:` / breaking change yet, it may correctly report **no release**—that is expected for docs-only or chore-only commits.

5. **Conventional commits** — PRs to `main` are commitlint-checked ([`CONTRIBUTING.md`](CONTRIBUTING.md)). Use at least one **`fix:`** or **`feat:`** on `main` before expecting the first npm version.

6. **After the first successful publish** — A git tag (e.g. `v0.1.0`), GitHub Release, `CHANGELOG.md` update, and version bump commit are produced by semantic-release. That commit message includes **`[skip ci]`** so it does not re-trigger endless release loops.

**What runs on push to `main`:** both [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and [`.github/workflows/release.yml`](.github/workflows/release.yml) run (overlapping steps; release adds `semantic-release`). Pushes that only change ignored paths still run workflows unless you configure path filters later.

### Watch runs with GitHub CLI

If you use [`gh`](https://cli.github.com/):

```bash
gh auth status
gh repo set-default OWNER/loxberry-client-library   # optional; your canonical repo
# after: git push origin main
gh run list --limit 8
gh run watch                                        # follow the most recent run (prompts if needed)
```

Filter by workflow: `gh run list --workflow=release.yml` or `gh run list --workflow=ci.yml`.

## Root package (`loxberry-client-library`)

The **`version`** field in root `package.json` is **updated by semantic-release** when a release happens; until then it may show an initial placeholder (e.g. **`0.0.1`**). [semantic-release](https://semantic-release.gitbook.io/) computes the next version from [Conventional Commits](https://www.conventionalcommits.org/) on `main` (`fix:` → patch, `feat:` → minor, breaking change → major).

**First release after enabling semantic-release:** there is no git tag yet, so the “last release” is treated as **0.0.0**. The **first published version is not always 0.0.1** — it depends on commits on `main` since the beginning of history (or use `git tag` if you need a custom starting point). Examples:

- Only **`fix:`**-type releasable commits → often **`0.0.1`**.
- Any **`feat:`** (minor bump from 0.0.0) → often **`0.1.0`**.
- Only **`docs:`** / **`chore:`** / **`ci:`** with no `fix`/`feat` → **no release** (semantic-release exits successfully with nothing to publish).

So: use at least one **`fix:`** or **`feat:`** on `main` before expecting npm/GitHub release output. The workflow also creates a **git tag** (e.g. `v0.1.0`) and a **GitHub Release** (via `@semantic-release/github`), and commits **`CHANGELOG.md`** + version bump via **`@semantic-release/git`**.

### GitHub Actions

Workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) runs on every push to `main`: tests, README CLI sync check, full build, MCP smoke test, then installs semantic-release with `npm install --no-save` and runs `npx semantic-release`.

### Authentication (recommended: npm trusted publishing / OIDC)

**Best practice** for unattended, low-human publishing is [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OpenID Connect from **GitHub-hosted** Actions). Short-lived registry credentials are minted per run; you avoid long-lived **`NPM_TOKEN`** secrets.

1. On [npmjs.com](https://www.npmjs.com/) → your package → **Settings** → **Trusted publishing** → **GitHub Actions**.
2. Point it at this repo and set the workflow filename to **`release.yml`** exactly (case-sensitive, including `.yml`). That must match [`.github/workflows/release.yml`](.github/workflows/release.yml).
3. Ensure **`package.json`** `repository.url` matches the GitHub repo URL npm expects (forks must fix this before publish).
4. The workflow already sets **`id-token: write`**, uses **Node ≥ 22.14**, and upgrades **npm to ≥ 11.5.1** (required by npm for OIDC).

The **`npm`** CLI detects the Actions OIDC environment and authenticates **`npm publish`** (including the one **`@semantic-release/npm`** runs) **before** falling back to a classic token.

After a successful OIDC publish, npm recommends tightening the package: **Settings → Publishing access →** require 2FA and **disallow classic publish tokens** for that package, then revoke old automation tokens. See npm’s [trusted publishers](https://docs.npmjs.com/trusted-publishers/) page.

**Provenance:** for **public** packages published from a **public** GitHub repo via trusted publishing, npm attaches provenance automatically (no extra flags).

#### Optional fallback: `NPM_TOKEN`

While migrating (or if you cannot use trusted publishing yet), add a repo secret **`NPM_TOKEN`** (npm automation or granular **publish** token). If the secret is **absent**, npm uses OIDC when trusted publishing is configured; if **present**, it can act as fallback per npm’s token order.

| Credential | Role |
|------------|------|
| **`GITHUB_TOKEN`** | Automatic. **`@semantic-release/git`** (push) + **`@semantic-release/github`** (releases). PAT only if branch protection blocks the default token. |
| **OIDC (trusted publisher)** | Preferred for **`npm publish`**. No secret. |
| **`NPM_TOKEN`** | Optional classic fallback. |

Your local [`.npmrc`](.npmrc) `ignore-scripts=true` is unrelated to publish auth.

**Forks:** pushes to `main` on a fork without your npm setup will fail at publish (expected). Either disable the workflow on forks or skip the release job when `github.repository` is not the canonical repo.

#### Troubleshooting npm in CI

- **`404` OIDC / “package not found”** — [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) is bound to a package that **already exists** on the registry. If **`loxberry-client-library`** has never been published, OIDC exchange can fail with **package not found**. Fix: publish **once** (e.g. local **`npm login`** → **`npm run build`** → **`npm publish --access public`**) or add a GitHub Actions secret **`NPM_TOKEN`** (automation token with publish rights) and **re-run** the failed **Release** workflow; then attach **Trusted publishing** in the package’s npm settings for future OIDC-only runs.
- **`EINVALIDNPMTOKEN` / `npm whoami` 401** — With an empty **`NPM_TOKEN`**, npm relies on OIDC; if OIDC failed first, verification fails. Resolve with a valid **`NPM_TOKEN`** or a working trusted-publisher setup after the package exists.

### Changelog

[@semantic-release/changelog](https://github.com/semantic-release/changelog) updates **`CHANGELOG.md`** and commits it together with the version bump (see `.releaserc.json`).

### Preview what a release would do (local dry run)

From the repo root:

```bash
npm run release:dry-run
```

That installs the same semantic-release plugins the [Release workflow](.github/workflows/release.yml) uses (without adding them to `package.json`) and runs **`semantic-release --dry-run`**. You should see log lines for **next version**, **commits** analyzed, **notes** preview, and **“published”** steps simulated — **nothing is pushed, tagged, or published to npm**.

**Caveats:**

- **Git push simulation** may error with `EGITNOPERMISSION` if your `origin` remote is not writable (e.g. fork or HTTPS without rights). That does **not** mean CI will fail the same way: GitHub Actions uses **`GITHUB_TOKEN`** with repo access.
- **npm publish** is also simulated; real publish needs **trusted publishing** or **`NPM_TOKEN`** on the server.

To clean extra packages after experimenting: `npm prune` (optional).

### What happens on a real push to `main`

1. [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs (tests, typecheck, README sync, build, MCP smoke).
2. [`.github/workflows/release.yml`](.github/workflows/release.yml) runs the same checks, then **`npx semantic-release`** for real: may create a **version commit**, **git tag**, **GitHub Release**, **CHANGELOG**, and **npm publish** — only if conventional commits warrant a release and auth succeeds.

## Workspace package (`loxberry-client-mcp`)

The MCP server is a **second npm package** (`loxberry-client-mcp`) under `packages/loxberry-client-mcp`. The root **`semantic-release` job only publishes `loxberry-client-library`** today. To ship **both** on npm:

1. **Publish the core library first** (so `loxberry-client-library` exists on the registry at a known version).
2. In `packages/loxberry-client-mcp/package.json`, replace  
   `"loxberry-client-library": "file:../.."`  
   with a **semver range** that matches the published core, e.g. `"^0.0.1"` or `"^0.1.0"`.
3. Bump **`packages/loxberry-client-mcp` `version`** when you cut an MCP release (it can track the core version or use its own semver).
4. From the repo root:  
   `npm publish -w loxberry-client-mcp --access public`  
   (with the same **trusted publishing** / **`NPM_TOKEN`** setup as the core package — register a **second** trusted publisher on npmjs for **`loxberry-client-mcp`**, same workflow file **`release.yml`**, or use a token for that package.)

**Automating two packages in one workflow** is optional (e.g. a follow-up step or `semantic-release` monorepo tooling). Until then, treat the MCP publish as a **manual or scripted** step after the core release.

**`workspace:` protocol:** On **npm 9+**, monorepos often use `"loxberry-client-library": "workspace:*"` so `npm publish -w loxberry-client-mcp` rewrites the dependency in the packed tarball. Older npm versions may not support `workspace:`; keep `file:../..` for local dev and swap to semver only when publishing if needed.

## README CLI reference

After editing [`src/cli-reference.ts`](src/cli-reference.ts), run:

```bash
npm run docs:sync-cli
```

CI fails if `README.md` is out of sync with that file.
