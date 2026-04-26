import type { Buffer } from "node:buffer";
import type { FetchLike } from "../json-rpc.js";
import { LoxBerryHttpError } from "../errors.js";

/**
 * Binary body for {@link PluginAdminHttp.uploadPluginZip} — Web `BufferSource` / `Blob` plus Node
 * `Buffer` (TS 6 models `Buffer` backing as `ArrayBufferLike`, which is not assignable to `BufferSource` alone).
 */
export type PluginZipBody = Blob | BufferSource | Buffer;

export interface InstalledPlugin {
  md5: string;
  folder: string;
  name: string;
  title?: string;
  version?: string;
}

export interface PluginAdminPaths {
  /** GET HTML listing (stock: `plugininstall.cgi`) */
  list: string;
  /** POST multipart upload (stock: same CGI as list) */
  upload: string;
  /** Uninstall base URL without query (stock: `plugininstall.cgi`) */
  uninstall: string;
  /** GET install log (stock LoxBerry uses dynamic `logfile.cgi?logfile=...` — override per install) */
  installLog: string;
}

/** Paths from [LoxBerry `plugininstall.cgi`](https://github.com/mschlenstedt/Loxberry) and templates. */
export const defaultPluginAdminPaths: PluginAdminPaths = {
  list: "/admin/system/plugininstall.cgi",
  upload: "/admin/system/plugininstall.cgi",
  uninstall: "/admin/system/plugininstall.cgi",
  installLog: "/admin/system/tools/logfile.cgi",
};

export interface PluginAdminHttpOptions {
  fetch?: FetchLike;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  paths?: Partial<PluginAdminPaths>;
  /** Stock LoxBerry field name for the zip is `uploadfile`. */
  uploadFieldName?: string;
  /** @deprecated Stock uninstall uses GET `do=uninstall&pid=` — this field is ignored for default paths. */
  uninstallIdField?: string;
  /**
   * Called with human-readable lines (timestamps included). Also enable with env
   * **`LOXBERRY_CLIENT_DEBUG=1`** when this is unset.
   */
  traceLog?: (message: string) => void;
  /**
   * After each successful plugin list GET, receive the raw body (HTML or JSON string).
   * For live-test artifacts / parser debugging only.
   */
  captureListHtml?: (body: string) => void;
}

export interface UploadPluginOptions {
  /** Required for stock LoxBerry install (4–10 chars). */
  securePin?: string;
}

export class PluginAdminHttp {
  private readonly fetchImpl: FetchLike;
  private readonly getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  private readonly paths: PluginAdminPaths;
  private readonly uploadFieldName: string;
  private readonly traceLog?: (message: string) => void;
  private readonly captureListHtml?: (body: string) => void;

  constructor(
    private readonly baseUrl: string,
    options: PluginAdminHttpOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.getHeaders = options.getHeaders;
    this.paths = { ...defaultPluginAdminPaths, ...options.paths };
    this.uploadFieldName = options.uploadFieldName ?? "uploadfile";
    this.captureListHtml = options.captureListHtml;
    this.traceLog =
      options.traceLog ??
      (typeof process !== "undefined" && process.env?.LOXBERRY_CLIENT_DEBUG === "1"
        ? (line) => console.error(`[LoxBerry:plugins] ${line}`)
        : undefined);
  }

  private trace(line: string): void {
    const ts = new Date().toISOString();
    this.traceLog?.(`${ts} ${line}`);
  }

  private base(): string {
    return this.baseUrl.replace(/\/$/, "");
  }

  private async headers(extra?: HeadersInit): Promise<HeadersInit> {
    const h = this.getHeaders?.();
    const resolved = h instanceof Promise ? await h : (h ?? {});
    return { ...resolved, ...extra };
  }

  async listInstalledPlugins(): Promise<InstalledPlugin[]> {
    const url = `${this.base()}${this.paths.list}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: await this.headers({ Accept: "text/html,application/json" }),
      credentials: "include",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new LoxBerryHttpError(`Plugin list failed: HTTP ${res.status}`, res.status, text.slice(0, 300));
    }
    this.captureListHtml?.(text);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const rows = parsePluginListJson(text);
      this.trace(
        `listInstalledPlugins JSON: ${rows.length} row(s) — ${rows.map((r) => r.folder || r.name).join(", ") || "(none)"}`,
      );
      return rows;
    }
    const rows = parsePluginRowsFromHtml(text);
    this.trace(
      `listInstalledPlugins HTML: ${rows.length} row(s), body ${text.length} B — ${rows.map((r) => r.folder || r.name).join(", ") || "(none)"}`,
    );
    return rows;
  }

  async uploadPluginZip(
    file: PluginZipBody,
    filename: string,
    uploadOptions: UploadPluginOptions = {},
  ): Promise<string> {
    const raw = await toZipBytes(file);
    const copy = Uint8Array.from(raw);
    const zipPart =
      typeof File !== "undefined"
        ? new File([copy], filename, { type: "application/zip" })
        : new Blob([copy], { type: "application/zip" });

    const form = new FormData();
    // Match browser `main_form` field order (see stock plugininstall.cgi template).
    form.append("saveformdata", "1");
    form.append("archiveurl", "");
    form.append(this.uploadFieldName, zipPart, filename);
    if (uploadOptions.securePin != null && uploadOptions.securePin !== "") {
      form.append("securepin", uploadOptions.securePin);
    }
    form.append("btnsubmit", "");

    const url = `${this.base()}${this.paths.upload}`;
    this.trace(
      `uploadPluginZip POST ${url} zip=${copy.byteLength} B filename=${JSON.stringify(filename)}`,
    );
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: await this.headers(),
      body: form,
      credentials: "include",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new LoxBerryHttpError(`Plugin upload failed: HTTP ${res.status}`, res.status, text.slice(0, 300));
    }
    const tempfile = extractInstallLogTempfileFromHtml(text);
    this.trace(
      `uploadPluginZip response HTTP ${res.status}, ${text.length} B, progressPage=${isPluginInstallProgressPageHtml(text)} tempfile=${tempfile ?? "?"}`,
    );
    assertLooksLikeInstallProgressOrThrow(text);
    return text;
  }

  /**
   * Stock LoxBerry: GET `plugininstall.cgi?do=uninstall&pid=<md5>`, then confirm with `&answer=1`.
   */
  async uninstallPlugin(pluginMd5: string): Promise<string> {
    const u = `${this.base()}${this.paths.uninstall}`;
    const step1 = `${u}?do=uninstall&pid=${encodeURIComponent(pluginMd5)}`;
    this.trace(`uninstallPlugin step1 GET confirm page pid=${pluginMd5.slice(0, 12)}…`);
    const r1 = await this.fetchImpl(step1, {
      method: "GET",
      headers: await this.headers({ Accept: "text/html,*/*" }),
      credentials: "include",
    });
    await r1.text();
    if (!r1.ok) {
      throw new LoxBerryHttpError(
        `Plugin uninstall (step 1) failed: HTTP ${r1.status}`,
        r1.status,
      );
    }
    const step2 = `${u}?do=uninstall&pid=${encodeURIComponent(pluginMd5)}&answer=1`;
    this.trace(`uninstallPlugin step2 GET answer=1`);
    const r2 = await this.fetchImpl(step2, {
      method: "GET",
      headers: await this.headers({ Accept: "text/html,*/*" }),
      credentials: "include",
    });
    const text = await r2.text();
    if (!r2.ok) {
      throw new LoxBerryHttpError(
        `Plugin uninstall (confirm) failed: HTTP ${r2.status}`,
        r2.status,
        text.slice(0, 300),
      );
    }
    this.trace(`uninstallPlugin done HTTP ${r2.status}, body ${text.length} B`);
    return text;
  }

  async getInstallLog(): Promise<string> {
    const url = `${this.base()}${this.paths.installLog}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: await this.headers({ Accept: "text/plain,text/html,*/*" }),
      credentials: "include",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new LoxBerryHttpError(`Install log failed: HTTP ${res.status}`, res.status, text.slice(0, 300));
    }
    return text;
  }

  /**
   * Stock install UI polls `logfile.cgi?logfile=<tempfile>.log&header=html&format=html&clientsize=…`.
   * `logFileName` is the value from {@link extractInstallLogTempfileFromHtml} (e.g. `AbCd1234.log`).
   */
  async getInstallLogFile(
    logFileName: string,
    options: { clientSize?: number } = {},
  ): Promise<string> {
    const clientSize = options.clientSize ?? 0;
    const q = new URLSearchParams({
      logfile: logFileName,
      header: "html",
      format: "html",
      clientsize: String(clientSize),
    });
    const url = `${this.base()}${this.paths.installLog}?${q.toString()}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: await this.headers({ Accept: "text/plain,text/html,*/*" }),
      credentials: "include",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new LoxBerryHttpError(
        `Install log file failed: HTTP ${res.status}`,
        res.status,
        text.slice(0, 300),
      );
    }
    return text;
  }

  /**
   * Poll the per-upload tempfile log until `plugininstall.pl` finishes (success or hard failure).
   * Call this after {@link uploadPluginZip} using {@link extractInstallLogTempfileFromHtml}(html)
   * **before** {@link waitForPluginFolder}; otherwise the plugin row may not exist yet.
   */
  async followPluginInstallTempLog(
    logFileName: string,
    options: {
      intervalMs?: number;
      timeoutMs?: number;
      isComplete?: (log: string) => boolean;
      isFailure?: (log: string) => boolean;
    } = {},
  ): Promise<string> {
    const intervalMs = options.intervalMs ?? 1_500;
    const timeoutMs = options.timeoutMs ?? 180_000;
    const isFailure =
      options.isFailure ??
      ((log: string) =>
        /\b(LOGCRIT|LOGFAIL|Sub ERROR|ERR_NOFOLDER|ERR_PLUGINCFG|ERR_UNKNOWNINTERFACE|ERR_EXTRACTING|ERR_ARCHIVEFORMAT)\b/i.test(
          log,
        ) ||
        /\bInstallation failed\b/i.test(log) ||
        /\bCould not parse plugin\.cfg\b/i.test(log));
    const isComplete =
      options.isComplete ??
      ((log: string) =>
        /Everything seems to be OK/i.test(log) ||
        /All Plugin files were installed successfully|system was cleaned up/i.test(log) ||
        /installation complete|successfully installed|MSG_ALLOK/i.test(log));
    const start = Date.now();
    let last = "";
    let poll = 0;
    this.trace(`followPluginInstallTempLog ${logFileName} timeout=${timeoutMs}ms`);
    while (Date.now() - start < timeoutMs) {
      poll += 1;
      last = await this.getInstallLogFile(logFileName);
      if (isFailure(last)) {
        throw new LoxBerryHttpError(
          `Plugin install log reports failure (see appliance log). Last ~600 chars: ${last.slice(-600).replace(/\s+/g, " ")}`,
          500,
          last.slice(0, 500),
        );
      }
      if (isComplete(last)) {
        this.trace(
          `followPluginInstallTempLog ${logFileName} done after ${poll} poll(s), +${Date.now() - start}ms, ${last.length} B`,
        );
        return last;
      }
      this.trace(
        `followPluginInstallTempLog ${logFileName} poll #${poll} +${Date.now() - start}ms len=${last.length} B (no success pattern yet)`,
      );
      await sleep(intervalMs);
    }
    throw new LoxBerryHttpError(
      `Timeout waiting for install log ${logFileName} (${timeoutMs}ms). Last ~500 chars: ${last.slice(-500).replace(/\s+/g, " ")}`,
      408,
      last.slice(0, 400),
    );
  }

  async followInstallLog(options: {
    intervalMs?: number;
    timeoutMs?: number;
    isComplete?: (log: string) => boolean;
  } = {}): Promise<string> {
    const intervalMs = options.intervalMs ?? 800;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const isComplete =
      options.isComplete ??
      ((log: string) =>
        /installation (complete|finished|done)/i.test(log) ||
        /successfully installed/i.test(log) ||
        /MSG_ALLOK/i.test(log));
    const start = Date.now();
    let last = "";
    while (Date.now() - start < timeoutMs) {
      last = await this.getInstallLog();
      if (isComplete(last)) return last;
      await sleep(intervalMs);
    }
    return last;
  }

  /**
   * Stock LoxBerry runs `plugininstall.pl` in a background process after upload; the plugin
   * row appears only when install finishes. Poll the list until `folder` is present (and
   * optionally `title` matches).
   */
  async waitForPluginFolder(
    folder: string,
    options: {
      intervalMs?: number;
      timeoutMs?: number;
      /** When set, the row must also match this title (trimmed). */
      title?: string;
    } = {},
  ): Promise<InstalledPlugin> {
    const intervalMs = options.intervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const wantTitle = options.title?.trim();
    const start = Date.now();
    let lastCount = 0;
    let attempt = 0;
    let lastFolders: string[] = [];
    while (Date.now() - start < timeoutMs) {
      attempt += 1;
      const list = await this.listInstalledPlugins();
      lastCount = list.length;
      lastFolders = list.map((p) => p.folder || p.name).filter(Boolean);
      const elapsed = Date.now() - start;
      this.trace(
        `waitForPluginFolder "${folder}" poll #${attempt} (+${elapsed}ms / ${timeoutMs}ms): count=${list.length} folders=[${lastFolders.join(", ")}]`,
      );
      const hit = list.find((p) => {
        const sameFolder = p.folder === folder || p.name === folder;
        if (!sameFolder) return false;
        if (wantTitle != null && wantTitle !== "" && p.title?.trim() !== wantTitle) {
          return false;
        }
        return true;
      });
      if (hit) {
        this.trace(`waitForPluginFolder: matched md5=${hit.md5} title=${JSON.stringify(hit.title ?? "")}`);
        return hit;
      }
      await sleep(intervalMs);
    }
    const zeroHint =
      lastCount === 0
        ? " Parser returned zero plugins — check HTML from GET plugininstall.cgi or LOXBERRY_BASE_URL."
        : "";
    const seen =
      lastFolders.length > 0
        ? ` Last folders parsed: ${lastFolders.slice(0, 40).join(", ")}${lastFolders.length > 40 ? "…" : ""}.`
        : "";
    throw new LoxBerryHttpError(
      `Timeout waiting for plugin folder "${folder}" in list (${timeoutMs}ms, ${attempt} polls, last count ${lastCount}).${zeroHint}${seen} ` +
        "Install runs asynchronously on the appliance after upload.",
      408,
    );
  }
}

async function toZipBytes(file: PluginZipBody): Promise<Uint8Array> {
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (ArrayBuffer.isView(file)) {
    const v = file;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return new Uint8Array(await (file as Blob).arrayBuffer());
}

/** Stock successful POST returns `plugininstall_log.html` with live log polling — not the error template. */
function assertLooksLikeInstallProgressOrThrow(text: string): void {
  if (text.length < 400 || !/<html/i.test(text)) return;
  if (looksLikePluginInstallProgressHtml(text)) return;
  if (looksLikePluginInstallErrorHtml(text)) {
    const errorSummary = extractHtmlAlertSummary(text);
    const pinHint =
      /securepin|SecurePIN/i.test(text) && /wrong|error|invalid|ERR_/i.test(text)
        ? "Response mentions SecurePIN/errors — check LOXBERRY_SECURE_PIN. "
        : "";
    const details = errorSummary ? ` Server message: ${errorSummary} ` : " ";
    throw new LoxBerryHttpError(
      `${pinHint}Upload POST returned an install error page.${details}First ~350 chars: ${text.slice(0, 350).replace(/\s+/g, " ")}`,
      500,
      text.slice(0, 400),
    );
  }
  // Some LoxBerry variants redirect/render plugin management HTML without the classic #Logfile marker
  // even though installation is triggered in background. Treat as non-fatal and let callers verify via list/log.
}

function looksLikePluginInstallProgressHtml(html: string): boolean {
  return (
    /id\s*=\s*["']Logfile["']/i.test(html) ||
    /plugininstall-status/.test(html) ||
    /Processing installation/i.test(html) ||
    /\/admin\/system\/tools\/logfile\.cgi\?logfile=/i.test(html)
  );
}

function looksLikePluginInstallErrorHtml(html: string): boolean {
  const hasErrorTokens =
    /\b(ERR_[A-Z0-9_]+|LOGCRIT|LOGFAIL|Sub ERROR)\b/.test(html) ||
    /An error occurred\..*not be installed/i.test(html) ||
    /could not be installed/i.test(html);
  const mentionsSecurePin = /securepin|SecurePIN/i.test(html) && /(wrong|invalid|error|falsch)/i.test(html);
  return hasErrorTokens || mentionsSecurePin;
}

function extractHtmlAlertSummary(html: string): string | undefined {
  const templateErrorMatches = html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of templateErrorMatches) {
    const headline = (m[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const detail = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const combined = `${headline}${detail ? ` ${detail}` : ""}`.trim();
    if (/(error|failed|invalid|falsch|wrong|lock|locked|ERR_[A-Z0-9_]+)/i.test(combined)) {
      return combined.slice(0, 260);
    }
  }

  const divMatches = Array.from(
    html.matchAll(/<div[^>]*class=["'][^"']*alert[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi),
  );
  for (const m of divMatches) {
    const text = (m[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/(error|failed|invalid|falsch|warning|ERR_[A-Z0-9_]+)/i.test(text)) {
      return text.slice(0, 260);
    }
  }
  return undefined;
}

/** True if HTML looks like the stock post-upload install log viewer (not the generic error page). */
export function isPluginInstallProgressPageHtml(html: string): boolean {
  return looksLikePluginInstallProgressHtml(html);
}

/**
 * Parses the random tempfile name from the install progress HTML (e.g. `AbCd1234.log`).
 */
export function extractInstallLogTempfileFromHtml(html: string): string | undefined {
  const m = /\/admin\/system\/tools\/logfile\.cgi\?logfile=([^&"'<>\s]+)/i.exec(html);
  const raw = m?.[1]?.trim();
  if (!raw || !/\.log$/i.test(raw)) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Result of {@link summarizePluginUninstallPageHtml} — stock UI is HTML, not JSON. */
export type PluginUninstallPageSummary = {
  status: "success" | "failure" | "unknown";
  summary: string;
};

/**
 * Best-effort parse of the stock post-uninstall HTML (`plugininstall.cgi` confirm step).
 * LoxBerry returns a full page; this maps common templates to a short status for APIs/MCP.
 */
export function summarizePluginUninstallPageHtml(html: string): PluginUninstallPageSummary {
  const t = html.slice(0, 100_000);
  if (/Everything ok!/i.test(t) && /uninstalled successfully/i.test(t)) {
    return {
      status: "success",
      summary: "LoxBerry reports the plugin was uninstalled successfully.",
    };
  }
  if (
    /\buninstall(?:ation)?\s+failed\b/i.test(t) ||
    /\bcould not\s+uninstall\b/i.test(t) ||
    /\bERR_[A-Z0-9_]+\b/.test(t)
  ) {
    return {
      status: "failure",
      summary:
        "Response looks like an uninstall error (heuristic). Check Plugin Management on the appliance.",
    };
  }
  return {
    status: "unknown",
    summary:
      "Could not match the usual success or error template; verify the plugin list on the appliance.",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function parsePluginRowsFromHtml(html: string): InstalledPlugin[] {
  const plugins: InstalledPlugin[] = [];

  const pluginRowRe =
    /<tr\b(?=[^>]*\bpluginrow\b)(?=[^>]*\bdata-md5\s*=\s*["']([a-fA-F0-9]{6,})["'])[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = pluginRowRe.exec(html)) !== null) {
    const md5 = m[1];
    if (!md5) continue;
    const inner = m[2] ?? "";
    const folder =
      /href=["']\/admin\/plugins\/([^/"']+)\/?["']/i.exec(inner)?.[1] ?? "";
    const title =
      /<a[^>]+href=["']\/admin\/plugins\/[^"'#]+["'][^>]*>([^<]+)<\/a>/i.exec(
        inner,
      )?.[1]
        ?.trim() ?? undefined;
    const version =
      new RegExp(`id="curver-${escapeRe(md5)}">([^<]+)<`, "i").exec(inner)?.[1]
        ?.trim() ?? undefined;
    const name = folder;
    plugins.push({ md5, folder, name, title, version });
  }

  const trOpen = /<tr\b[^>]*>/gi;
  while ((m = trOpen.exec(html)) !== null) {
    const tag = m[0];
    if (/\bpluginrow\b/i.test(tag)) continue;
    const md5 = attr(tag, "data-md5") ?? attr(tag, "data-pluginmd5");
    if (!md5) continue;
    const folder = attr(tag, "data-folder") ?? attr(tag, "data-pluginfolder") ?? "";
    const name = attr(tag, "data-name") ?? folder;
    const title = attr(tag, "data-title");
    const version = attr(tag, "data-version");
    plugins.push({ md5, folder, name, title, version });
  }

  return plugins;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  return re.exec(tag)?.[1];
}

function parsePluginListJson(text: string): InstalledPlugin[] {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) {
    throw new LoxBerryHttpError("Expected JSON array of plugins", 500, text.slice(0, 200));
  }
  return data.map((row) => {
    if (typeof row !== "object" || row === null) {
      throw new LoxBerryHttpError("Invalid plugin row in JSON", 500);
    }
    const r = row as Record<string, unknown>;
    const md5 = String(r.md5 ?? r.MD5 ?? "");
    if (!md5) {
      throw new LoxBerryHttpError("Plugin row missing md5", 500);
    }
    return {
      md5,
      folder: String(r.folder ?? r.FOLDER ?? ""),
      name: String(r.name ?? r.NAME ?? r.folder ?? ""),
      title: r.title != null ? String(r.title) : undefined,
      version: r.version != null ? String(r.version) : undefined,
    };
  });
}
