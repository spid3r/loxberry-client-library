import type { LoxBerryClient } from "./client.js";

export interface MqttConnectionDetails {
  brokeraddress?: string;
  brokerhost?: string;
  brokerport?: string;
  websocketport?: string;
  brokeruser?: string;
  brokerpass?: string;
  udpinport?: string;
}

/**
 * Returns broker connection hints from LoxBerry (PHP `mqtt_connectiondetails` / JSON-RPC).
 * Shape may vary by version; callers should treat fields as optional strings.
 *
 * Does not connect to MQTT — use your own client (`mqtt`, `aedes`, etc.) with these fields.
 */
export async function fetchMqttConnectionDetails(
  client: LoxBerryClient,
): Promise<MqttConnectionDetails | null> {
  const candidates = ["mqtt_connectiondetails", "LBIO::mqtt_connectiondetails"];
  for (const method of candidates) {
    try {
      const res = await client.call<MqttConnectionDetails | null>(method, []);
      if (res && typeof res === "object") return res;
      if (res === null) return null;
    } catch {
      /* try next */
    }
  }
  return null;
}
