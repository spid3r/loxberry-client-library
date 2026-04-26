import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "mocha";
import {
  findLatestLoxberryPluginZip,
  isLikelyLoxberryPluginMd5,
  readFolderFromPluginCfg,
} from "../src/plugin-dev-helpers.js";

describe("plugin-dev-helpers", () => {
  it("isLikelyLoxberryPluginMd5 accepts 32 hex", () => {
    assert.equal(isLikelyLoxberryPluginMd5("a".repeat(32)), true);
    assert.equal(isLikelyLoxberryPluginMd5("wasteapiio"), false);
  });

  it("readFolderFromPluginCfg reads FOLDER=", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbcfg-"));
    try {
      fs.writeFileSync(
        path.join(dir, "plugin.cfg"),
        "VERSION=1.0.0\nFOLDER=myplugin\n",
        "utf-8",
      );
      assert.equal(readFolderFromPluginCfg(dir), "myplugin");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("findLatestLoxberryPluginZip picks newest mtime", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbzip-"));
    try {
      const dist = path.join(dir, "dist");
      fs.mkdirSync(dist, { recursive: true });
      const a = path.join(dist, "loxberry-plugin-a-1.0.0.zip");
      const b = path.join(dist, "loxberry-plugin-b-1.0.0.zip");
      fs.writeFileSync(a, "x", "utf-8");
      fs.writeFileSync(b, "y", "utf-8");
      const older = Date.now() - 60_000;
      fs.utimesSync(a, new Date(older), new Date(older));
      assert.equal(findLatestLoxberryPluginZip(dir), b);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
