import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal `.env` reader for tests only — no `dotenv` dependency.
 * Does not override keys already set in `process.env`.
 */
export function loadEnvFileIfPresent(absPath: string): void {
  if (!existsSync(absPath)) return;
  const text = readFileSync(absPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
