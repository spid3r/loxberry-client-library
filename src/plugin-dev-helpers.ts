/**
 * Small helpers for the `loxberry-client` CLI: resolve plugin folder from
 * `plugin.cfg`, find the newest `dist/loxberry-plugin-*.zip`, resolve uninstall pid.
 * Keep this file Node-only (sync fs) — not part of the browser bundle.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

const MD5_RE = /^[a-f0-9]{32}$/i;

/** `FOLDER=` from stock `plugin.cfg` (LoxBerry plugin). */
export function readFolderFromPluginCfg(projectRoot: string): string {
  const f = path.join(projectRoot, "plugin.cfg");
  if (!existsSync(f)) {
    throw new Error(`No plugin.cfg in ${path.resolve(projectRoot)}`);
  }
  const text = readFileSync(f, "utf-8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("FOLDER="));
  const v = line ? line.split("=").slice(1).join("=").trim() : "";
  if (!v) {
    throw new Error(`FOLDER= missing in ${f}`);
  }
  return v;
}

/** Newest mtime in `dist/loxberry-plugin-*.zip` under project root. */
export function findLatestLoxberryPluginZip(projectRoot: string): string {
  const dist = path.join(projectRoot, "dist");
  if (!existsSync(dist)) {
    throw new Error(`No dist/ directory in ${path.resolve(projectRoot)} (build the plugin ZIP first)`);
  }
  const names = readdirSync(dist);
  const zips: string[] = [];
  for (const n of names) {
    if (!n.endsWith(".zip") || !n.startsWith("loxberry-plugin-")) continue;
    const full = path.join(dist, n);
    if (statSync(full).isFile()) zips.push(full);
  }
  if (zips.length === 0) {
    throw new Error(`No loxberry-plugin-*.zip in ${path.resolve(dist)}`);
  }
  zips.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return zips[0]!;
}

export function isLikelyLoxberryPluginMd5(s: string): boolean {
  return MD5_RE.test(s.trim());
}
