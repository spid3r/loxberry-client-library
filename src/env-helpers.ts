import type { HttpBasicCredentials } from "./auth/http-basic.js";
import type { LoxBerryAuthStrategy } from "./auth/session.js";

/**
 * Reads optional HTTP Basic credentials from the environment (Node).
 * - `LOXBERRY_HTTP_BASIC_USERNAME` + `LOXBERRY_HTTP_BASIC_PASSWORD`, or
 * - `LOXBERRY_HTTP_BASIC_SAME=1` to reuse `LOXBERRY_USERNAME` / `LOXBERRY_PASSWORD`.
 */
export function httpBasicCredentialsFromEnv(): HttpBasicCredentials | undefined {
  const bu = process.env.LOXBERRY_HTTP_BASIC_USERNAME;
  const bp = process.env.LOXBERRY_HTTP_BASIC_PASSWORD;
  if (bu && bp) {
    return { username: bu, password: bp };
  }
  if (process.env.LOXBERRY_HTTP_BASIC_SAME === "1") {
    const u = process.env.LOXBERRY_USERNAME;
    const p = process.env.LOXBERRY_PASSWORD;
    if (u && p) {
      return { username: u, password: p };
    }
  }
  return undefined;
}

/** Path for GET+POST login, e.g. `/admin/index.php`. Override when your build uses a different URL. */
export function loginPathFromEnv(
  fallback = "/admin/index.php",
): string {
  const p = process.env.LOXBERRY_LOGIN_PATH?.trim();
  return p && p.length > 0 ? p : fallback;
}

/** `form` only if you really use an HTML login form; stock LoxBerry is `basic`. */
export function authStrategyFromEnv(): LoxBerryAuthStrategy {
  const s = process.env.LOXBERRY_AUTH_STRATEGY?.trim().toLowerCase();
  if (s === "form") return "form";
  return "basic";
}

export function loginFormFieldsFromEnv(): {
  usernameField?: string;
  passwordField?: string;
} {
  const u = process.env.LOXBERRY_LOGIN_USER_FIELD?.trim();
  const pw = process.env.LOXBERRY_LOGIN_PASSWORD_FIELD?.trim();
  return {
    ...(u ? { usernameField: u } : {}),
    ...(pw ? { passwordField: pw } : {}),
  };
}
