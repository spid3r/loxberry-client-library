import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as path from "node:path";
import {
  authStrategyFromEnv,
  extractInstallLogTempfileFromHtml,
  httpBasicCredentialsFromEnv,
  loginFormFieldsFromEnv,
  loginPathFromEnv,
  LoxBerryClient,
  SessionAuth,
} from "./index.js";
import { formatCliHelpText } from "./cli-reference.js";
import {
  findLatestLoxberryPluginZip,
  isLikelyLoxberryPluginMd5,
  readFolderFromPluginCfg,
} from "./plugin-dev-helpers.js";

type PluginsApi = LoxBerryClient["plugins"];

async function runUploadWithOptionalWait(
  plugins: PluginsApi,
  buf: Buffer,
  fileLabel: string,
  securePin: string | undefined,
  waitInstall: boolean,
  pluginFolder: string,
): Promise<void> {
  const name = fileLabel.split(/[/\\]/).pop() ?? "plugin.zip";
  const body = await plugins.uploadPluginZip(buf, name, { securePin });
  if (!waitInstall) {
    console.log(body);
    return;
  }
  const tempfile = extractInstallLogTempfileFromHtml(body);
  if (tempfile) {
    await plugins.followPluginInstallTempLog(tempfile);
  }
  if (pluginFolder) {
    const row = await plugins.waitForPluginFolder(pluginFolder);
    console.log(JSON.stringify({ ok: true, plugin: row }, null, 2));
  } else {
    const tail = tempfile
      ? { ok: true, message: "install log complete (no --plugin-folder, skipped list wait)" }
      : { ok: true, message: "no tempfile in upload HTML; pass --plugin-folder to poll plugins list" };
    console.log(JSON.stringify(tail, null, 2));
  }
}

/**
 * LoxBerry sometimes returns a non-zero or throws even though the install completed.
 * If the installed row's md5 changed vs. before, treat as success (same as stock UI quirks some users see over automation).
 */
async function deployWithOptionalMd5SuccessQuirk(
  client: LoxBerryClient,
  zipPath: string,
  folder: string,
  securePin: string | undefined,
): Promise<void> {
  const plugins = client.plugins;
  const before = await plugins.listInstalledPlugins();
  const beforeMd5 = new Map<string, string>();
  for (const p of before) {
    const key = p.folder || p.name;
    if (key) beforeMd5.set(String(key), (p.md5 ?? "").trim());
  }
  const buf = Buffer.from(await readFile(zipPath));
  const base = path.basename(zipPath);
  try {
    await runUploadWithOptionalWait(plugins, buf, base, securePin, true, folder);
  } catch (err) {
    const after = await plugins.listInstalledPlugins();
    const row = after.find((p) => p.folder === folder);
    const oldM = beforeMd5.get(folder) ?? "";
    const newM = (row?.md5 ?? "").trim();
    if (row && newM && newM !== oldM) {
      process.stderr.write(
        `[loxberry-client] primary deploy flow failed (${err instanceof Error ? err.message : String(err)}), ` +
          `but plugin folder '${folder}' md5 changed (${oldM || "n/a"} -> ${newM}) — treating as success.\n`,
      );
      console.log(
        JSON.stringify(
          { ok: true, plugin: row, quirk: "md5-changed-despite-failed-primary-flow" },
          null,
          2,
        ),
      );
      return;
    }
    throw err;
  }
}

async function resolveUninstallPluginMd5(plugins: PluginsApi, nameOrFolder: string): Promise<string> {
  const t = nameOrFolder.trim();
  if (isLikelyLoxberryPluginMd5(t)) {
    return t;
  }
  const list = await plugins.listInstalledPlugins();
  const row = list.find((p) => p.folder === t || p.name === t);
  if (!row?.md5) {
    throw new Error(
      `No installed plugin with folder/name '${t}' in plugins list (or missing md5). ` +
        `Run 'plugins list' and use --name <32-char-md5> if needed.`,
    );
  }
  return row.md5.trim();
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      baseUrl: { type: "string" },
      user: { type: "string" },
      password: { type: "string" },
      file: { type: "string" },
      name: { type: "string" },
      follow: { type: "boolean" },
      params: { type: "string" },
      securePin: { type: "string" },
      "wait-install": { type: "boolean" },
      "plugin-folder": { type: "string" },
      /** Project root: directory containing `plugin.cfg` and `dist/` (used by \`plugins deploy\`). */
      project: { type: "string" },
    },
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(0);
  }

  const [cmd, ...rest] = positionals;
  const baseUrl = values.baseUrl ?? process.env.LOXBERRY_BASE_URL;
  if (!baseUrl && cmd !== "help") {
    throw new Error("Set LOXBERRY_BASE_URL or pass --baseUrl");
  }

  if (cmd === "jsonrpc" && rest[0] === "call") {
    const method = rest[1];
    if (!method) throw new Error("Usage: jsonrpc call <method> [--params JSON]");
    const session = await maybeLogin(baseUrl!, values);
    const client = new LoxBerryClient({
      baseUrl: baseUrl!,
      session: session ?? undefined,
      httpBasic: session ? undefined : httpBasicCredentialsFromEnv(),
    });
    const params = values.params ? (JSON.parse(values.params) as unknown) : [];
    const result = await client.call(method, params);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "plugins") {
    const sub = rest[0];
    const session = await maybeLogin(baseUrl!, values);
    const client = new LoxBerryClient({
      baseUrl: baseUrl!,
      session: session ?? undefined,
      httpBasic: session ? undefined : httpBasicCredentialsFromEnv(),
    });
    if (sub === "list") {
      const list = await client.plugins.listInstalledPlugins();
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    if (sub === "upload") {
      const f = values.file;
      if (!f) throw new Error("Usage: plugins upload --file path/to.zip");
      const buf = Buffer.from(await readFile(f));
      const securePin = values.securePin ?? process.env.LOXBERRY_SECURE_PIN;
      const waitInstall = values["wait-install"] === true;
      const pluginFolder = (values["plugin-folder"] ?? "").trim();
      await runUploadWithOptionalWait(
        client.plugins,
        buf,
        f,
        securePin,
        waitInstall,
        pluginFolder,
      );
      return;
    }
    if (sub === "deploy") {
      const projectRoot = path.resolve(values.project ?? process.cwd());
      const folder =
        (values["plugin-folder"] && values["plugin-folder"].trim() !== ""
          ? values["plugin-folder"]
          : readFolderFromPluginCfg(projectRoot)) || "";
      const zipPath = values.file
        ? path.resolve(values.file)
        : findLatestLoxberryPluginZip(projectRoot);
      const securePin = values.securePin ?? process.env.LOXBERRY_SECURE_PIN;
      await deployWithOptionalMd5SuccessQuirk(client, zipPath, folder, securePin);
      return;
    }
    if (sub === "uninstall") {
      const id = values.name;
      if (!id) {
        throw new Error("Usage: plugins uninstall --name <md5 | plugin folder from plugin.cfg FOLDER=>");
      }
      const md5 = await resolveUninstallPluginMd5(client.plugins, id);
      const body = await client.plugins.uninstallPlugin(md5);
      console.log(body);
      return;
    }
  }

  if (cmd === "logs" && rest[0] === "install") {
    const session = await maybeLogin(baseUrl!, values);
    const client = new LoxBerryClient({
      baseUrl: baseUrl!,
      session: session ?? undefined,
      httpBasic: session ? undefined : httpBasicCredentialsFromEnv(),
    });
    if (values.follow) {
      const log = await client.plugins.followInstallLog();
      console.log(log);
    } else {
      console.log(await client.plugins.getInstallLog());
    }
    return;
  }

  printHelp();
  process.exit(1);
}

async function maybeLogin(
  baseUrl: string,
  values: { user?: string; password?: string },
): Promise<SessionAuth | null> {
  const user = values.user ?? process.env.LOXBERRY_USERNAME;
  const password = values.password ?? process.env.LOXBERRY_PASSWORD;
  if (!user || !password) return null;
  const auth = new SessionAuth();
  const strategy = authStrategyFromEnv();
  await auth.login(baseUrl, user, password, {
    strategy,
    httpBasic: httpBasicCredentialsFromEnv(),
    loginPath: loginPathFromEnv(),
    ...loginFormFieldsFromEnv(),
  });
  return auth;
}

function printHelp(): void {
  console.log(formatCliHelpText());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
