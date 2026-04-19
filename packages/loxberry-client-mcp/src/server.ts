import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  authStrategyFromEnv,
  extractInstallLogTempfileFromHtml,
  httpBasicCredentialsFromEnv,
  isPluginInstallProgressPageHtml,
  loginFormFieldsFromEnv,
  loginPathFromEnv,
  LoxBerryClient,
  LoxBerryHttpError,
  SessionAuth,
  summarizePluginUninstallPageHtml,
  type InstalledPlugin,
} from "loxberry-client-library";

function findInstalledPlugin(
  list: InstalledPlugin[],
  pluginId: string,
): InstalledPlugin | undefined {
  const t = pluginId.trim().toLowerCase();
  return list.find(
    (p) =>
      p.md5.toLowerCase() === t ||
      p.folder.toLowerCase() === t ||
      p.name.toLowerCase() === t,
  );
}

let clientPromise: Promise<LoxBerryClient> | null = null;

async function getClient(): Promise<LoxBerryClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const baseUrl = process.env.LOXBERRY_BASE_URL;
      if (!baseUrl) {
        throw new Error("Set LOXBERRY_BASE_URL in the MCP server environment");
      }
      const auth = new SessionAuth();
      const user = process.env.LOXBERRY_USERNAME;
      const pass = process.env.LOXBERRY_PASSWORD;
      const httpBasic = httpBasicCredentialsFromEnv();
      if (user && pass) {
        await auth.login(baseUrl, user, pass, {
          strategy: authStrategyFromEnv(),
          httpBasic,
          loginPath: loginPathFromEnv(),
          ...loginFormFieldsFromEnv(),
        });
      }
      return new LoxBerryClient({ baseUrl, session: auth, httpBasic });
    })();
  }
  return clientPromise;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

const server = new McpServer(
  { name: "loxberry-client-mcp", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

const annReadOnlyRemote: {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
} = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};

const annRpc: {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
} = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

server.registerTool(
  "plugins_list",
  {
    description: "List installed LoxBerry plugins (read-only; does not change the appliance).",
    annotations: annReadOnlyRemote,
  },
  async () => {
    const client = await getClient();
    const list = await client.plugins.listInstalledPlugins();
    return textResult(JSON.stringify(list, null, 2));
  },
);

server.registerTool(
  "plugins_upload",
  {
    description:
      "Upload a plugin .zip from a path on this machine, then (by default) poll the per-upload install tempfile until success/failure. Returns JSON with status and log excerpt — not the raw progress HTML page. Changes appliance state (installs a plugin).",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      filePath: z.string().describe("Absolute or relative path to the plugin zip"),
      securePin: z
        .string()
        .optional()
        .describe("LoxBerry SecurePIN; defaults to LOXBERRY_SECURE_PIN env"),
      followInstallLog: z
        .boolean()
        .optional()
        .describe(
          "If true (default), extract tempfile from the upload response and poll followPluginInstallTempLog until done or timeout. If false, return metadata + short HTML preview only.",
        ),
      installTimeoutMs: z
        .number()
        .optional()
        .describe("Max wait for install log completion (default 180000)"),
      logTailChars: z
        .number()
        .optional()
        .describe("Max characters of install log to include in the response (default 8000)"),
    }),
  },
  async ({
    filePath,
    securePin,
    followInstallLog = true,
    installTimeoutMs,
    logTailChars,
  }) => {
    const buf = await readFile(filePath);
    const client = await getClient();
    const name = filePath.split(/[/\\]/).pop() ?? "plugin.zip";
    const pin = securePin ?? process.env.LOXBERRY_SECURE_PIN;
    const body = await client.plugins.uploadPluginZip(buf, name, {
      securePin: pin,
    });

    const tail = Math.min(Math.max(logTailChars ?? 8000, 500), 50_000);
    const tempfile = extractInstallLogTempfileFromHtml(body);

    if (!followInstallLog) {
      return jsonResult({
        phase: "upload_only",
        tempfile,
        looksLikeProgressPage: isPluginInstallProgressPageHtml(body),
        responseBytes: body.length,
        responsePreview: body.slice(0, 1200),
      });
    }

    if (!tempfile) {
      return jsonResult({
        status: "no_tempfile",
        summary:
          "Upload response did not contain an install tempfile link. Check SecurePIN, zip validity, or whether the response is an error page.",
        looksLikeProgressPage: isPluginInstallProgressPageHtml(body),
        responsePreview: body.slice(0, 1200),
      });
    }

    try {
      const log = await client.plugins.followPluginInstallTempLog(tempfile, {
        timeoutMs: installTimeoutMs ?? 180_000,
      });
      return jsonResult({
        status: "success",
        tempfile,
        summary:
          "Plugin install log finished with a success pattern (e.g. “Everything seems to be OK”).",
        logTail: log.slice(-tail),
      });
    } catch (e) {
      if (e instanceof LoxBerryHttpError) {
        const snippet = e.bodySnippet;
        return jsonResult({
          status: e.status === 408 ? "timeout" : "failed",
          tempfile,
          summary: e.message,
          ...(typeof snippet === "string" && snippet.length > 0
            ? { logTail: snippet.slice(-tail) }
            : {}),
        });
      }
      throw e;
    }
  },
);

server.registerTool(
  "plugins_uninstall",
  {
    title: "Uninstall plugin (destructive)",
    description:
      "DANGER: Permanently removes an installed plugin from the LoxBerry (data loss for that plugin). " +
      "Matches `pluginId` against plugins_list (md5, folder, or name); if nothing matches, no uninstall is sent. " +
      "After uninstall, re-lists plugins so success means the row is gone (LoxBerry HTML alone can lie). " +
      "Requires confirmPhrase === UNINSTALL_CONFIRMED.",
    annotations: {
      title: "Uninstall plugin (destructive)",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      pluginId: z
        .string()
        .describe(
          "Plugin id for stock uninstall URL (`pid=`). Prefer the `md5` value from plugins_list — folder name may not uninstall reliably.",
        ),
      confirmPhrase: z
        .literal("UNINSTALL_CONFIRMED")
        .describe(
          'Must be exactly the string UNINSTALL_CONFIRMED — intentional safety latch; omitting or mistyping refuses the call.',
        ),
      includeHtmlPreview: z
        .boolean()
        .optional()
        .describe(
          "If true, include a short snippet of the raw HTML (debug only; default false).",
        ),
    }),
  },
  async ({ pluginId, includeHtmlPreview }) => {
    const client = await getClient();
    const before = await client.plugins.listInstalledPlugins();
    const row = findInstalledPlugin(before, pluginId);
    if (!row) {
      return jsonResult({
        pluginId,
        status: "not_installed",
        wasInstalled: false,
        summary:
          "No installed plugin matches this id (compare md5, folder, or name from plugins_list). Uninstall was not sent — LoxBerry can still show a bogus “success” page for unknown pids.",
      });
    }

    const pid = row.md5;
    const html = await client.plugins.uninstallPlugin(pid);
    const parsed = summarizePluginUninstallPageHtml(html);
    const after = await client.plugins.listInstalledPlugins();
    const stillInstalled = findInstalledPlugin(after, pid) !== undefined;

    let status: string;
    let summary: string;
    if (stillInstalled) {
      status = "failed";
      summary =
        "Plugin still appears in plugins_list after uninstall. The stock HTML may still look like success; check Plugin Management on the appliance.";
    } else {
      status = "success";
      summary =
        parsed.status === "success"
          ? "Plugin removed (verified: no longer in plugins_list)."
          : `Removed from list, but the HTML was not the usual success template (${parsed.summary})`;
    }

    return jsonResult({
      pluginId,
      resolvedMd5: pid,
      wasInstalled: true,
      stillInstalled,
      htmlTemplateStatus: parsed.status,
      status,
      summary,
      responseBytes: html.length,
      ...(includeHtmlPreview === true
        ? { htmlPreview: html.slice(0, 1_500) }
        : {}),
    });
  },
);

server.registerTool(
  "logs_install",
  {
    description:
      "Read or follow the plugin installation log output (read-only; does not uninstall or install plugins).",
    annotations: annReadOnlyRemote,
    inputSchema: z.object({
      follow: z
        .boolean()
        .optional()
        .describe("Poll until completion (default false)"),
    }),
  },
  async ({ follow }) => {
    const client = await getClient();
    const log = follow
      ? await client.plugins.followInstallLog()
      : await client.plugins.getInstallLog();
    return textResult(log);
  },
);

server.registerTool(
  "jsonrpc_call",
  {
    description:
      "Call LoxBerry JSON-RPC (POST /admin/system/jsonrpc.php). Method may read or write appliance state — caller is responsible for using safe read-only methods when exploring.",
    annotations: annRpc,
    inputSchema: z.object({
      method: z.string(),
      params: z
        .string()
        .optional()
        .describe("JSON array or object, default []"),
    }),
  },
  async ({ method, params }) => {
    const client = await getClient();
    const parsed = params ? (JSON.parse(params) as unknown) : [];
    const result = await client.call(method, parsed);
    return textResult(JSON.stringify(result, null, 2));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
