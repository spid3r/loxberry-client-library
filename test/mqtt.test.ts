import { strict as assert } from "node:assert";
import { describe, it } from "mocha";
import type { LoxBerryClient } from "../src/client.js";
import { fetchMqttConnectionDetails } from "../src/mqtt.js";

describe("fetchMqttConnectionDetails", () => {
  it("returns object from first successful jsonrpc method", async () => {
    const stub = {
      async call<T>(_m: string, _p?: unknown): Promise<T> {
        return {
          brokerhost: "mqtt.local",
          brokerport: "1883",
        } as T;
      },
    } as LoxBerryClient;

    const d = await fetchMqttConnectionDetails(stub);
    assert.equal(d?.brokerhost, "mqtt.local");
    assert.equal(d?.brokerport, "1883");
  });

  it("tries fallback method names", async () => {
    let n = 0;
    const stub = {
      async call<T>(m: string, _p?: unknown): Promise<T> {
        n += 1;
        if (m === "mqtt_connectiondetails") {
          throw new Error("no");
        }
        if (m === "LBIO::mqtt_connectiondetails") {
          return { brokerhost: "h" } as T;
        }
        throw new Error("unexpected");
      },
    } as LoxBerryClient;

    const d = await fetchMqttConnectionDetails(stub);
    assert.equal(d?.brokerhost, "h");
    assert.equal(n, 2);
  });
});
