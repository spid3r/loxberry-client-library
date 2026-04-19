/**
 * Use this `fetch` in tests with {@link MockAgent} — Node's `globalThis.fetch` may not use the same dispatcher.
 *
 * Cast: `undici`'s `fetch` uses its own `Request` type; our `FetchLike` uses the DOM `Request` in `RequestInfo`.
 */
import type { FetchLike } from "../../src/json-rpc.js";
import { fetch as undiciFetchImpl } from "undici";

export const undiciFetch = undiciFetchImpl as unknown as FetchLike;
