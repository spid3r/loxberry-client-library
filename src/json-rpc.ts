import { JsonRpcError as JsonRpcErrorClass } from "./errors.js";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type JsonRpcId = string | number | null;

export interface JsonRpcSingleRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSingleResponse<T = unknown> {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normalizeParams(params: unknown | undefined): unknown {
  if (params === undefined) {
    return [];
  }
  return params;
}

export class JsonRpcTransport {
  constructor(
    private readonly endpointUrl: string,
    private readonly options: {
      fetch?: FetchLike;
      getHeaders?: () => HeadersInit | Promise<HeadersInit>;
    } = {},
  ) {}

  private get fetchImpl(): FetchLike {
    return this.options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async headers(): Promise<HeadersInit> {
    const h = this.options.getHeaders?.();
    return h instanceof Promise ? await h : (h ?? {});
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    const id = Math.floor(Math.random() * 1e9);
    const body: JsonRpcSingleRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params: normalizeParams(params),
    };
    const res = await this.fetchImpl(this.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(await this.headers()),
      },
      body: JSON.stringify(body),
      credentials: "include",
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new JsonRpcErrorClass(
        -32700,
        `Invalid JSON-RPC response (HTTP ${res.status})`,
        text.slice(0, 500),
      );
    }
    if (!isRecord(parsed)) {
      throw new JsonRpcErrorClass(-32700, "Invalid JSON-RPC envelope");
    }
    if (Array.isArray(parsed)) {
      throw new JsonRpcErrorClass(-32600, "Unexpected JSON-RPC batch response for single call");
    }
    if (parsed.error) {
      const err = parsed.error as { code: number; message: string; data?: unknown };
      throw new JsonRpcErrorClass(err.code, err.message, err.data);
    }
    if (parsed.id !== id && parsed.id !== undefined && parsed.id !== null) {
      // Some servers echo different id; still return result if present
    }
    return parsed.result as T;
  }

  async batch<T extends unknown[]>(
    requests: readonly { method: string; params?: unknown }[],
  ): Promise<T> {
    const batchBody: JsonRpcSingleRequest[] = requests.map((r, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: r.method,
      params: normalizeParams(r.params),
    }));
    const res = await this.fetchImpl(this.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(await this.headers()),
      },
      body: JSON.stringify(batchBody),
      credentials: "include",
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new JsonRpcErrorClass(
        -32700,
        `Invalid JSON-RPC batch response (HTTP ${res.status})`,
        text.slice(0, 500),
      );
    }
    if (!Array.isArray(parsed)) {
      throw new JsonRpcErrorClass(-32600, "Expected JSON-RPC batch array response");
    }
    const byId = new Map<number, JsonRpcSingleResponse>();
    for (const item of parsed) {
      if (!isRecord(item)) continue;
      if (typeof item.id === "number") {
        byId.set(item.id, item as unknown as JsonRpcSingleResponse);
      }
    }
    const ordered: unknown[] = [];
    for (let i = 0; i < requests.length; i++) {
      const id = i + 1;
      const one = byId.get(id);
      if (!one) {
        throw new JsonRpcErrorClass(-32603, `Missing batch result for id ${id}`);
      }
      if (one.error) {
        throw new JsonRpcErrorClass(one.error.code, one.error.message, one.error.data);
      }
      ordered.push(one.result);
    }
    return ordered as T;
  }
}
