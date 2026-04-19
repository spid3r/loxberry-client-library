import { strict as assert } from "node:assert";
import { after, before, describe, it } from "mocha";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { JsonRpcError } from "../src/errors.js";
import { JsonRpcTransport } from "../src/json-rpc.js";
import type { Dispatcher } from "undici";
import { undiciFetch } from "./helpers/undici-fetch.js";

const rpc = (url: string) =>
  new JsonRpcTransport(url, { fetch: undiciFetch });

describe("JsonRpcTransport", () => {
  const origin = "http://lb.fixture";
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

  it("call: returns result for single JSON-RPC response", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({ path: "/admin/system/jsonrpc.php", method: "POST" })
      .reply(200, { jsonrpc: "2.0", id: 1, result: { x: 42 } });

    const t = rpc(`${origin}/admin/system/jsonrpc.php`);
    const r = await t.call<{ x: number }>("LBSystem::get_miniservers", []);
    assert.equal(r.x, 42);
  });

  it("call: maps JSON-RPC error to JsonRpcError", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({ path: "/admin/system/jsonrpc.php", method: "POST" })
      .reply(200, {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      });

    const t = rpc(`${origin}/admin/system/jsonrpc.php`);
    await assert.rejects(t.call("missing::method", []), (e: unknown) => {
      assert.ok(e instanceof JsonRpcError);
      assert.equal((e as JsonRpcError).code, -32601);
      return true;
    });
  });

  it("call: defaults params to empty array", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({
        path: "/admin/system/jsonrpc.php",
        method: "POST",
        body: (b) => {
          const j = JSON.parse(b.toString()) as { params: unknown };
          return Array.isArray(j.params) && j.params.length === 0;
        },
      })
      .reply(200, { jsonrpc: "2.0", id: 1, result: true });

    const t = rpc(`${origin}/admin/system/jsonrpc.php`);
    const ok = await t.call<boolean>("getdirs", undefined);
    assert.equal(ok, true);
  });

  it("batch: preserves order of results", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({ path: "/admin/system/jsonrpc.php", method: "POST" })
      .reply(200, [
        { jsonrpc: "2.0", id: 1, result: "a" },
        { jsonrpc: "2.0", id: 2, result: "b" },
      ]);

    const t = rpc(`${origin}/admin/system/jsonrpc.php`);
    const out = await t.batch<[string, string]>([
      { method: "m1", params: [] },
      { method: "m2", params: [1] },
    ]);
    assert.deepEqual(out, ["a", "b"]);
  });

  it("batch: throws on embedded error", async () => {
    const pool = agent.get(origin);
    pool
      .intercept({ path: "/admin/system/jsonrpc.php", method: "POST" })
      .reply(200, [
        { jsonrpc: "2.0", id: 1, result: "ok" },
        { jsonrpc: "2.0", id: 2, error: { code: 1, message: "nope" } },
      ]);

    const t = rpc(`${origin}/admin/system/jsonrpc.php`);
    await assert.rejects(
      t.batch([{ method: "a" }, { method: "b" }]),
      (e: unknown) => e instanceof JsonRpcError,
    );
  });
});
