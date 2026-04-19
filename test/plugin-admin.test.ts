import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "mocha";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";
import { LoxBerryClient } from "../src/client.js";
import {
  extractInstallLogTempfileFromHtml,
  isPluginInstallProgressPageHtml,
  parsePluginRowsFromHtml,
  summarizePluginUninstallPageHtml,
} from "../src/plugins/admin-http.js";
import { undiciFetch } from "./helpers/undici-fetch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("install progress HTML helpers", () => {
  it("isPluginInstallProgressPageHtml detects stock log viewer", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "install-progress-snippet.html"),
      "utf8",
    );
    assert.equal(isPluginInstallProgressPageHtml(html), true);
    assert.equal(extractInstallLogTempfileFromHtml(html), "TestTemp123.log");
  });

  it("isPluginInstallProgressPageHtml is false for trivial body", () => {
    assert.equal(isPluginInstallProgressPageHtml("uploaded"), false);
    assert.equal(isPluginInstallProgressPageHtml("<html><body>no</body></html>"), false);
  });
});

describe("summarizePluginUninstallPageHtml", () => {
  it("detects stock success template", () => {
    const html = `<html><body><h2>Everything ok!</h2><p>The plugin was uninstalled successfully.</p></body></html>`;
    const s = summarizePluginUninstallPageHtml(html);
    assert.equal(s.status, "success");
    assert.match(s.summary, /uninstalled successfully/i);
  });

  it("detects heuristic failure", () => {
    const html = `<html><body><p>Uninstallation failed: ERR_NOPLUGIN</p></body></html>`;
    const s = summarizePluginUninstallPageHtml(html);
    assert.equal(s.status, "failure");
  });

  it("returns unknown for unrelated HTML", () => {
    const s = summarizePluginUninstallPageHtml("<html><body>Plugin Management</body></html>");
    assert.equal(s.status, "unknown");
  });
});

describe("parsePluginRowsFromHtml", () => {
  it("parses stock LoxBerry plugininstall.cgi pluginrow tr", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "loxberry-plugininstall-snippet.html"),
      "utf8",
    );
    const rows = parsePluginRowsFromHtml(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.md5, "deadbeef");
    assert.equal(rows[0]?.folder, "myplugin");
    assert.equal(rows[0]?.title, "My Plugin Title");
    assert.equal(rows[0]?.version, "1.2.3");
  });

  it("reads data-* attributes from tr opening tags", async () => {
    const html = await readFile(join(__dirname, "fixtures", "plugins-list.html"), "utf8");
    const rows = parsePluginRowsFromHtml(html);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.md5, "f21873f370693661863909d413dbdc50");
    assert.equal(rows[0]?.folder, "miniserverbackup");
    assert.equal(rows[0]?.title, "Miniserver Backup");
  });
});

describe("PluginAdminHttp (mocked)", () => {
  const origin = "http://lb.plugins";
  let agent: MockAgent;
  let previous: Dispatcher;

  before(() => {
    previous = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  after(async () => {
    await agent.close();
    setGlobalDispatcher(previous);
  });

  const paths = {
    list: "/p/list",
    upload: "/p/upload",
    uninstall: "/p/uninstall",
    installLog: "/p/log",
  };

  const client = () =>
    new LoxBerryClient({
      baseUrl: origin,
      pluginPaths: paths,
      fetch: undiciFetch,
    });

  it("listInstalledPlugins parses HTML", async () => {
    const html = await readFile(join(__dirname, "fixtures", "plugins-list.html"), "utf8");
    const pool = agent.get(origin);
    pool.intercept({ path: paths.list, method: "GET" }).reply(200, html, {
      headers: { "content-type": "text/html" },
    });

    const c = client();
    const list = await c.plugins.listInstalledPlugins();
    assert.equal(list.length, 2);
  });

  it("listInstalledPlugins parses JSON when content-type is application/json", async () => {
    const json = await readFile(join(__dirname, "fixtures", "plugins-list.json"), "utf8");
    const pool = agent.get(origin);
    pool.intercept({ path: paths.list, method: "GET" }).reply(200, json, {
      headers: { "content-type": "application/json" },
    });

    const c = client();
    const list = await c.plugins.listInstalledPlugins();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.name, "myplugin");
  });

  it("uploadPluginZip posts multipart", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({ path: paths.upload, method: "POST" })
      .reply(200, '<!DOCTYPE html><html><body><div id="Logfile"></div></body></html>');

    const c = client();
    const body = await c.plugins.uploadPluginZip(new Uint8Array([1, 2, 3]), "x.zip");
    assert.match(body, /Logfile/);
  });

  it("uninstallPlugin uses GET do=uninstall then answer=1", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({
        path: `${paths.uninstall}?do=uninstall&pid=abc`,
        method: "GET",
      })
      .reply(200, "<html>confirm</html>");
    pool
      .intercept({
        path: `${paths.uninstall}?do=uninstall&pid=abc&answer=1`,
        method: "GET",
      })
      .reply(200, "gone");

    const c = client();
    const body = await c.plugins.uninstallPlugin("abc");
    assert.equal(body, "gone");
  });

  it("followInstallLog stops when complete", async () => {
    const pool = agent.get(origin);
    let calls = 0;
    pool
      .intercept({ path: paths.installLog, method: "GET" })
      .reply(200, () => {
        calls += 1;
        return calls < 3 ? "extracting…" : "installation complete";
      })
      .persist();

    const c = client();
    const log = await c.plugins.followInstallLog({
      intervalMs: 1,
      timeoutMs: 2000,
    });
    assert.match(log, /complete/i);
    assert.ok(calls >= 3);
  });

  it("followPluginInstallTempLog polls logfile.cgi (tempfile query on URL)", async () => {
    const pool = agent.get(origin);
    let calls = 0;
    pool
      .intercept({ path: new RegExp(`^${paths.installLog.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`), method: "GET" })
      .reply(200, () => {
        calls += 1;
        return calls < 3 ? "unpack…" : "Everything seems to be OK";
      })
      .persist();

    const c = client();
    const log = await c.plugins.followPluginInstallTempLog("abc.log", {
      intervalMs: 1,
      timeoutMs: 3000,
    });
    assert.match(log, /Everything seems to be OK/);
    assert.ok(calls >= 3);
  });

  it("waitForPluginFolder polls list until row appears", async () => {
    const fullHtml = await readFile(join(__dirname, "fixtures", "plugins-list.html"), "utf8");
    const pool = agent.get(origin);
    let listCalls = 0;
    pool
      .intercept({ path: paths.list, method: "GET" })
      .reply(200, () => {
        listCalls += 1;
        return listCalls < 3 ? "<html><table></table></html>" : fullHtml;
      })
      .persist();

    const c = client();
    const hit = await c.plugins.waitForPluginFolder("miniserverbackup", {
      title: "Miniserver Backup",
      intervalMs: 1,
      timeoutMs: 5000,
    });
    assert.equal(hit.folder, "miniserverbackup");
    assert.equal(hit.title, "Miniserver Backup");
    assert.ok(listCalls >= 3);
  });
});
