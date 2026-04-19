export { JsonRpcError, LoxBerryHttpError } from "./errors.js";
export { JsonRpcTransport, type FetchLike } from "./json-rpc.js";
export {
  SessionAuth,
  type LoxBerryAuthStrategy,
  type SessionAuthOptions,
} from "./auth/session.js";
export {
  authorizationBasic,
  headersWithBasic,
  type HttpBasicCredentials,
} from "./auth/http-basic.js";
export {
  PluginAdminHttp,
  parsePluginRowsFromHtml,
  isPluginInstallProgressPageHtml,
  extractInstallLogTempfileFromHtml,
  summarizePluginUninstallPageHtml,
  defaultPluginAdminPaths,
  type InstalledPlugin,
  type PluginAdminPaths,
  type PluginAdminHttpOptions,
  type PluginUninstallPageSummary,
  type PluginZipBody,
  type UploadPluginOptions,
} from "./plugins/admin-http.js";
export { LoxBerryClient, type LoxBerryClientOptions } from "./client.js";
export {
  authStrategyFromEnv,
  httpBasicCredentialsFromEnv,
  loginFormFieldsFromEnv,
  loginPathFromEnv,
} from "./env-helpers.js";
