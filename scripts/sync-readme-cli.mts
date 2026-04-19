/**
 * Injects `formatCliReferenceMarkdown()` into README.md between HTML comment markers.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatCliReferenceMarkdown } from "../src/cli-reference.ts";

const START = "<!-- CLI_REFERENCE_START -->";
const END = "<!-- CLI_REFERENCE_END -->";

const root = fileURLToPath(new URL("..", import.meta.url));
const readmePath = `${root}/README.md`;

const text = await readFile(readmePath, "utf8");
const startIdx = text.indexOf(START);
const endIdx = text.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  throw new Error(
    `README.md must contain ${START} before ${END} (CLI reference block).`,
  );
}

const prefix = text.slice(0, startIdx + START.length);
const suffix = text.slice(endIdx);
const next = `${prefix}\n\n${formatCliReferenceMarkdown()}\n\n${suffix}`;

await writeFile(readmePath, next, "utf8");
console.log("Updated README.md CLI reference block.");
