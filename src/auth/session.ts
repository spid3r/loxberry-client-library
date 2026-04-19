import type { FetchLike } from "../json-rpc.js";
import type { HttpBasicCredentials } from "./http-basic.js";
import { headersWithBasic } from "./http-basic.js";

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  return re.exec(tag)?.[1];
}

/** Stock LoxBerry protects `htmlauth` with Apache Basic Auth (`.htaccess`), not a PHP form at `index.php`. */
export type LoxBerryAuthStrategy = "basic" | "form";

export interface SessionAuthOptions {
  fetch?: FetchLike;
  /**
   * `basic` (default): LoxBerry stock — HTTP Basic on `/admin` + GET dashboard to verify.
   * `form`: legacy HTML form POST (custom reverse proxies / old builds).
   */
  strategy?: LoxBerryAuthStrategy;
  /** With `basic`, paths tried in order until one returns 2xx. */
  basicProbePaths?: readonly string[];
  /** Path to admin login (GET + POST) when `strategy: "form"`. */
  loginPath?: string;
  usernameField?: string;
  passwordField?: string;
  extraFormFields?: Record<string, string>;
  /** Override Basic credentials; default is the same `username` / `password` passed to `login()`. */
  httpBasic?: HttpBasicCredentials;
}

const DEFAULT_BASIC_PATHS = [
  "/admin/system/index.cgi",
  "/admin/index.cgi",
] as const;

export class SessionAuth {
  private readonly cookies = new Map<string, string>();
  /** Sent on every request after successful `login()` (LoxBerry stock Basic layer). */
  private basicCredentials?: HttpBasicCredentials;

  getCookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  mergeSetCookieFromResponse(response: Response): void {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const lines =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : splitSetCookieFallback(headers.get("set-cookie"));
    for (const line of lines) {
      const part = line.split(";")[0]?.trim();
      if (!part?.includes("=")) continue;
      const eq = part.indexOf("=");
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  headersInit(): HeadersInit {
    const cookie = this.getCookieHeader();
    const base: Record<string, string> = cookie ? { Cookie: cookie } : {};
    return headersWithBasic(base, this.basicCredentials);
  }

  /**
   * LoxBerry stock: HTTP Basic with web UI user/password, then GET `/admin/system/index.cgi`.
   * Optional `strategy: "form"` for HTML form login at `loginPath`.
   */
  async login(
    baseUrl: string,
    username: string,
    password: string,
    options: SessionAuthOptions = {},
  ): Promise<void> {
    const strategy = options.strategy ?? "basic";
    if (strategy === "basic") {
      await this.loginBasic(baseUrl, username, password, options);
    } else {
      await this.loginForm(baseUrl, username, password, options);
    }
  }

  private async loginBasic(
    base: string,
    username: string,
    password: string,
    options: SessionAuthOptions,
  ): Promise<void> {
    const root = base.replace(/\/$/, "");
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    const basic: HttpBasicCredentials =
      options.httpBasic ?? { username, password };
    this.basicCredentials = basic;

    const paths = options.basicProbePaths?.length
      ? options.basicProbePaths
      : DEFAULT_BASIC_PATHS;

    let lastStatus = 0;
    let lastUrl = "";
    for (const p of paths) {
      const url = `${root}${p}`;
      lastUrl = url;
      const getRes = await fetchFn(url, {
        method: "GET",
        redirect: "follow",
        credentials: "include",
        headers: headersWithBasic(undefined, basic),
      });
      this.mergeSetCookieFromResponse(getRes);
      lastStatus = getRes.status;
      if (getRes.ok) {
        await getRes.text().catch(() => {});
        return;
      }
    }

    throw new Error(
      `LoxBerry admin probe failed (HTTP ${lastStatus}): GET ${lastUrl}. ` +
        `Stock LoxBerry uses HTTP Basic on /admin (see htmlauth/.htaccess). ` +
        `Check LOXBERRY_BASE_URL, username, and password. ` +
        `If you use a form login instead, set strategy: 'form' or LOXBERRY_AUTH_STRATEGY=form.`,
    );
  }

  private async loginForm(
    baseUrl: string,
    username: string,
    password: string,
    options: SessionAuthOptions,
  ): Promise<void> {
    const base = baseUrl.replace(/\/$/, "");
    const loginPath = options.loginPath ?? "/admin/index.php";
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    const userField = options.usernameField ?? "user";
    const passField = options.passwordField ?? "password";
    const basic = options.httpBasic;
    if (basic) {
      this.basicCredentials = basic;
    }

    const getRes = await fetchFn(`${base}${loginPath}`, {
      method: "GET",
      redirect: "follow",
      credentials: "include",
      headers: headersWithBasic(undefined, basic),
    });
    this.mergeSetCookieFromResponse(getRes);

    if (getRes.status === 404) {
      throw new Error(
        `LoxBerry login page not found (HTTP 404): GET ${base}${loginPath}. ` +
          `Try strategy 'basic' (default for stock LoxBerry) or set LOXBERRY_LOGIN_PATH.`,
      );
    }

    let hidden: Record<string, string> = {};
    if (getRes.ok) {
      const html = await getRes.text();
      hidden = extractHiddenInputs(html);
    }

    const body = new URLSearchParams({
      ...hidden,
      ...(options.extraFormFields ?? {}),
      [userField]: username,
      [passField]: password,
    });

    const postRes = await fetchFn(`${base}${loginPath}`, {
      method: "POST",
      headers: headersWithBasic(
        {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: this.getCookieHeader(),
        },
        basic,
      ),
      body,
      redirect: "manual",
      credentials: "include",
    });
    this.mergeSetCookieFromResponse(postRes);

    if (postRes.status >= 400) {
      let hint = "";
      if (postRes.status === 401) {
        hint =
          " Try strategy 'basic' if this is stock LoxBerry (Apache Basic on /admin).";
      } else if (postRes.status === 404) {
        hint = " Wrong login path (POST 404). Set loginPath / LOXBERRY_LOGIN_PATH.";
      }
      throw new Error(`LoxBerry login failed: HTTP ${postRes.status}.${hint}`);
    }
    if (postRes.status >= 300 && postRes.status < 400) {
      const loc = postRes.headers.get("location");
      if (loc) {
        const next = new URL(loc, `${base}/`);
        const follow = await fetchFn(next.toString(), {
          method: "GET",
          headers: headersWithBasic(
            { Cookie: this.getCookieHeader() },
            basic,
          ),
          redirect: "follow",
          credentials: "include",
        });
        this.mergeSetCookieFromResponse(follow);
      }
    }
  }
}

function splitSetCookieFallback(value: string | null): string[] {
  if (!value) return [];
  return [value];
}

function extractHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input\b[^>]*type="hidden"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const name = attr(tag, "name");
    const value = attr(tag, "value") ?? "";
    if (name) out[name] = value;
  }
  return out;
}
