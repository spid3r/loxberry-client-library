export class JsonRpcError extends Error {
  readonly name = "JsonRpcError";

  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class LoxBerryHttpError extends Error {
  readonly name = "LoxBerryHttpError";

  constructor(
    message: string,
    readonly status: number,
    readonly bodySnippet?: string,
  ) {
    super(message);
  }
}
