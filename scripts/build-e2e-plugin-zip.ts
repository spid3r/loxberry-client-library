/**
 * Builds a zip from test/fixtures/e2e-plugin for manual upload on a LoxBerry
 * (Plugin management → Install → same flow the live test uses).
 *
 * Stock plugininstall.pl always copies icons/*; missing icons/ makes that step fail.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const fixtureRoot = join(repoRoot, "test", "fixtures", "e2e-plugin");
const defaultOut = join(repoRoot, "tmp", "loxberryclie2e-manual-upload.zip");

async function addDir(zip: JSZip, rel: string): Promise<void> {
  const abs = join(fixtureRoot, rel);
  const entries = await readdir(abs, { withFileTypes: true });
  for (const ent of entries) {
    const next = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      await addDir(zip, next);
    } else {
      const buf = await readFile(join(fixtureRoot, next));
      zip.file(next.replace(/\\/g, "/"), buf);
    }
  }
}

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? defaultOut;
  await mkdir(dirname(outPath), { recursive: true });
  const zip = new JSZip();
  await addDir(zip, "");
  const nodebuf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await writeFile(outPath, nodebuf);
  console.log(`Wrote ${outPath} (${nodebuf.length} bytes)`);
  console.log("Upload this in LoxBerry: System → Plugin management → Install (with SecurePIN).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
