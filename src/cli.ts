import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  authStrategyFromEnv,
  httpBasicCredentialsFromEnv,
  loginFormFieldsFromEnv,
  loginPathFromEnv,
  LoxBerryClient,
  SessionAuth,
} from "./index.js";
import { formatCliHelpText } from "./cli-reference.js";

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
      const buf = await readFile(f);
      const name = f.split(/[/\\]/).pop() ?? "plugin.zip";
      const body = await client.plugins.uploadPluginZip(buf, name);
      console.log(body);
      return;
    }
    if (sub === "uninstall") {
      const id = values.name;
      if (!id) throw new Error("Usage: plugins uninstall --name <md5-or-folder>");
      const body = await client.plugins.uninstallPlugin(id);
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
