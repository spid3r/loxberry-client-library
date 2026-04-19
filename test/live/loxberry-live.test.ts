import { strict as assert } from "node:assert";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { before, describe, it } from "mocha";
import {
  authStrategyFromEnv,
  extractInstallLogTempfileFromHtml,
  httpBasicCredentialsFromEnv,
  loginFormFieldsFromEnv,
  loginPathFromEnv,
  LoxBerryClient,
  SessionAuth,
} from "../../src/index.js";
import { loadEnvFileIfPresent } from "../helpers/load-env-file.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

loadEnvFileIfPresent(join(repoRoot, ".env"));
const fixtureRoot = join(__dirname, "..", "fixtures", "e2e-plugin");

async function zipE2ePluginFixture(): Promise<Buffer> {
  const zip = new JSZip();
  async function addDir(rel: string): Promise<void> {
    const abs = join(fixtureRoot, rel);
    const entries = await readdir(abs, { withFileTypes: true });
    for (const ent of entries) {
      const next = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        await addDir(next);
      } else {
        const buf = await readFile(join(fixtureRoot, next));
        zip.file(next.replace(/\\/g, "/"), buf);
      }
    }
  }
  await addDir("");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Gate on LOXBERRY_LIVE_TESTS only (set by `npm run test:live*`), not on credentials in `.env`.
 * That way `LOXBERRY_BASE_URL` in `.env` for the CLI does not accidentally run appliance tests during `npm test`.
 */
if (process.env.LOXBERRY_LIVE_TESTS === "1") {
  const baseUrl = process.env.LOXBERRY_BASE_URL ?? "";
  const user = process.env.LOXBERRY_USERNAME ?? "";
  const pass = process.env.LOXBERRY_PASSWORD ?? "";
  const allowUpload = process.env.LOXBERRY_LIVE_UPLOAD === "1";
  const allowUninstall = process.env.LOXBERRY_LIVE_UNINSTALL === "1";
  const e2eFolder = process.env.LOXBERRY_E2E_PLUGIN_FOLDER ?? "loxberryclie2e";
  const e2eTitle = process.env.LOXBERRY_E2E_PLUGIN_TITLE ?? "E2E Client Lib";
  const installWaitMs = Number(process.env.LOXBERRY_LIVE_INSTALL_TIMEOUT_MS ?? 120_000);
  /** Mocha default is 2000ms; upload waits for forked plugininstall.pl on the appliance. */
  const mochaTimeoutMs = Math.min(600_000, Math.max(60_000, installWaitMs + 60_000));
  const liveDebug = process.env.LOXBERRY_LIVE_DEBUG === "1";
  const debugDir = join(repoRoot, "tmp", "loxberry-live-debug");

  describe("@live LoxBerry (LOXBERRY_LIVE_TESTS=1)", function () {
    this.timeout(60_000);

    let client: LoxBerryClient;

    before(async function () {
      if (!baseUrl) {
        throw new Error("LOXBERRY_BASE_URL is required when LOXBERRY_LIVE_TESTS=1");
      }
      if (!user || !pass) {
        throw new Error(
          "LOXBERRY_USERNAME and LOXBERRY_PASSWORD are required when LOXBERRY_LIVE_TESTS=1 (admin session)",
        );
      }
      if (liveDebug) {
        await mkdir(debugDir, { recursive: true });
        const banner = `\n========== live debug ${new Date().toISOString()} baseUrl=${baseUrl} ==========\n`;
        await appendFile(join(debugDir, "trace.log"), banner).catch(() => {});
        console.error(
          "[live-debug] LOXBERRY_LIVE_DEBUG=1 → writing tmp/loxberry-live-debug/ (list-latest.html, upload-response.html, uninstall-response.html, trace.log)",
        );
      }
      const httpBasic = httpBasicCredentialsFromEnv();
      const session = new SessionAuth();
      await session.login(baseUrl, user, pass, {
        strategy: authStrategyFromEnv(),
        httpBasic,
        loginPath: loginPathFromEnv(),
        ...loginFormFieldsFromEnv(),
      });
      client = new LoxBerryClient({
        baseUrl,
        session,
        httpBasic,
        pluginTraceLog: liveDebug
          ? (line) => {
              console.error("[live-debug]", line);
              void appendFile(join(debugDir, "trace.log"), `${line}\n`);
            }
          : undefined,
        capturePluginListHtml: liveDebug
          ? (body) => {
              void writeFile(join(debugDir, "list-latest.html"), body, "utf8");
            }
          : undefined,
      });
    });

    it("JSON-RPC: LBSystem::get_miniservers responds", async () => {
      const ms = await client.call<unknown>("LBSystem::get_miniservers", []);
      assert.ok(ms !== undefined);
    });

    it("plugin admin: listInstalledPlugins returns an array", async () => {
      const list = await client.plugins.listInstalledPlugins();
      assert.ok(Array.isArray(list));
      assert.ok(
        list.length >= 1,
        "parser returned zero plugins — HTML from plugininstall.cgi may not match stock layout (open an issue with a saved HTML snippet)",
      );
    });

    describe("plugin admin: upload / uninstall (slow)", function () {
      this.timeout(mochaTimeoutMs);

      it("upload E2E zip (LOXBERRY_LIVE_UPLOAD=1 only)", async function () {
        if (!allowUpload) {
          this.skip();
        }
        const zip = await zipE2ePluginFixture();
        const pin = process.env.LOXBERRY_SECURE_PIN;
        if (!pin) {
          throw new Error(
            "LOXBERRY_SECURE_PIN is required for live upload (LoxBerry SecurePIN)",
          );
        }
        const uploadHtml = await client.plugins.uploadPluginZip(zip, "loxberryclie2e-e2e.zip", {
          securePin: pin,
        });
        if (liveDebug) {
          await writeFile(join(debugDir, "upload-response.html"), uploadHtml, "utf8");
        }

        const tempfile = extractInstallLogTempfileFromHtml(uploadHtml);
        assert.ok(
          tempfile,
          "upload response should contain logfile.cgi?logfile=… (install progress page)",
        );
        // Same as the browser: wait for plugininstall.pl via tempfile log, then plugin list updates.
        await client.plugins.followPluginInstallTempLog(tempfile, {
          timeoutMs: installWaitMs,
          intervalMs: 2_000,
        });

        const hit = await client.plugins.waitForPluginFolder(e2eFolder, {
          timeoutMs: Math.min(90_000, Math.max(30_000, installWaitMs)),
          intervalMs: 1_500,
        });
        assert.equal(
          hit.title?.trim(),
          e2eTitle,
          "folder matched but TITLE differs — wrong plugin or parser stripped title wrong",
        );
      });

      it("uninstall E2E plugin (LOXBERRY_LIVE_UNINSTALL=1 only)", async function () {
        if (!allowUninstall) {
          this.skip();
        }
        const list = await client.plugins.listInstalledPlugins();
        const hit = list.find((p) => p.folder === e2eFolder || p.name === e2eFolder);
        assert.ok(hit, `E2E plugin ${e2eFolder} not installed; run upload test first or install manually`);
        assert.equal(
          hit?.title?.trim(),
          e2eTitle,
          "refusing uninstall: TITLE mismatch (safety check — wrong plugin?)",
        );
        const id = hit?.md5 ?? e2eFolder;
        const uninstallHtml = await client.plugins.uninstallPlugin(id);
        if (liveDebug) {
          await writeFile(join(debugDir, "uninstall-response.html"), uninstallHtml, "utf8");
        }

        const again = await client.plugins.listInstalledPlugins();
        const still = again.find((p) => p.folder === e2eFolder || p.name === e2eFolder);
        assert.ok(
          !still,
          `plugin row should disappear after uninstall; still see folder=${still?.folder} title=${still?.title} (parsed count=${again.length})`,
        );
      });
    });
  });
}
