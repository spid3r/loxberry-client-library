/** RFC 7617 Basic credentials (ASCII-oriented; same limitation as browsers' btoa). */
export interface HttpBasicCredentials {
  username: string;
  password: string;
}

export function authorizationBasic(creds: HttpBasicCredentials): string {
  const raw = `${creds.username}:${creds.password}`;
  const b64 =
    typeof globalThis.btoa === "function"
      ? globalThis.btoa(raw)
      : Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

export function headersWithBasic(
  base: HeadersInit | undefined,
  creds: HttpBasicCredentials | undefined,
): HeadersInit {
  if (!creds) {
    return base ?? {};
  }
  const out: Record<string, string> = {};
  if (base) {
    if (base instanceof Headers) {
      base.forEach((v, k) => {
        out[k] = v;
      });
    } else if (Array.isArray(base)) {
      for (const [k, v] of base) {
        out[k] = v;
      }
    } else {
      Object.assign(out, base as Record<string, string>);
    }
  }
  out.Authorization = authorizationBasic(creds);
  return out;
}
