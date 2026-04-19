import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "mocha";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";
import { SessionAuth } from "../src/auth/session.js";
import { undiciFetch } from "./helpers/undici-fetch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("SessionAuth", () => {
  const origin = "http://lb.session";
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

  it("login: merges Set-Cookie and posts credentials", async () => {
    const pool = agent.get(origin);
    const loginPath = "/admin/index.php";

    pool
      .intercept({ path: loginPath, method: "GET" })
      .reply(200, '<form><input type="hidden" name="token" value="t1"/></form>', {
        headers: {
          "content-type": "text/html",
          "set-cookie": "PHPSESSID=before; Path=/",
        },
      });

    pool
      .intercept({
        path: loginPath,
        method: "POST",
        body: (b) => {
          const s = b.toString();
          return (
            s.includes("user=admin") &&
            s.includes("password=secret") &&
            s.includes("token=t1")
          );
        },
      })
      .reply(302, "", {
        headers: {
          location: "/admin/home.php",
          "set-cookie": "PHPSESSID=after; Path=/",
        },
      });

    pool
      .intercept({ path: "/admin/home.php", method: "GET" })
      .reply(200, "ok", {
        headers: { "content-type": "text/plain" },
      });

    const auth = new SessionAuth();
    await auth.login(origin, "admin", "secret", {
      strategy: "form",
      loginPath,
      fetch: undiciFetch,
    });

    assert.match(auth.getCookieHeader(), /PHPSESSID=after/);
  });
});

describe("SessionAuth hidden inputs", () => {
  it("parses hidden fields from login page fixture shape", async () => {
    const html = await readFile(join(__dirname, "fixtures", "login-page.html"), "utf8");
    const auth = new SessionAuth();
    await auth.login("http://noop", "u", "p", {
      strategy: "form",
      fetch: async (input, init) => {
        const url = String(input);
        if (init?.method === "GET" && url.endsWith("/admin/index.php")) {
          return new Response(html, {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        if (init?.method === "POST") {
          const body = String(init.body ?? "");
          assert.match(body, /csrf=csrfval/);
          return new Response(null, { status: 302, headers: { location: "/ok" } });
        }
        return new Response("noop", { status: 404 });
      },
      loginPath: "/admin/index.php",
    });
  });
});
