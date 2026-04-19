import type { FetchLike } from "./json-rpc.js";
import { JsonRpcTransport } from "./json-rpc.js";
import type { SessionAuth } from "./auth/session.js";
import type { HttpBasicCredentials } from "./auth/http-basic.js";
import { headersWithBasic } from "./auth/http-basic.js";
import { PluginAdminHttp, type PluginAdminPaths } from "./plugins/admin-http.js";

export interface LoxBerryClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** When set, Cookie header is sent to JSON-RPC and plugin admin requests */
  session?: SessionAuth;
  /**
   * HTTP Basic Auth (e.g. Apache `Require valid-user` in front of `/admin`).
   * Use the credentials for that layer; form login still uses `session.login` user/password.
   */
  httpBasic?: HttpBasicCredentials;
  pluginPaths?: Partial<PluginAdminPaths>;
  /** Forwarded to plugin HTTP layer; see `PluginAdminHttpOptions.traceLog`. */
  pluginTraceLog?: (message: string) => void;
  /** Raw plugin list page body after each successful GET (HTML or JSON). */
  capturePluginListHtml?: (body: string) => void;
}

export class LoxBerryClient {
  private readonly rpc: JsonRpcTransport;
  readonly plugins: PluginAdminHttp;

  constructor(options: LoxBerryClientOptions) {
    const base = options.baseUrl.replace(/\/$/, "");
    const jsonrpcUrl = `${base}/admin/system/jsonrpc.php`;
    const session = options.session;
    const basic = options.httpBasic;
    const mergedHeaders = async (): Promise<HeadersInit> =>
      headersWithBasic(session?.headersInit(), basic);

    this.rpc = new JsonRpcTransport(jsonrpcUrl, {
      fetch: options.fetch,
      getHeaders: mergedHeaders,
    });
    this.plugins = new PluginAdminHttp(options.baseUrl, {
      fetch: options.fetch,
      getHeaders: mergedHeaders,
      paths: options.pluginPaths,
      traceLog: options.pluginTraceLog,
      captureListHtml: options.capturePluginListHtml,
    });
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    return this.rpc.call<T>(method, params);
  }

  batch<T extends unknown[]>(
    requests: readonly { method: string; params?: unknown }[],
  ): Promise<T> {
    return this.rpc.batch<T>(requests);
  }
}
