/** @internal Constructor shape for Cloudflare's native `NonRetryableError`. */
export interface NonRetryableErrorConstructor {
  new (message: string, name?: string): Error;
}

/**
 * Portable non-retryable workflow error.
 *
 * Throw this for invalid input or unrecoverable workflow work that should not be
 * retried. Generated Cloudflare entrypoints convert it to Cloudflare's native
 * `NonRetryableError` when that constructor is available.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** @internal Creates a native non-retryable error when Cloudflare provides one. */
export function makeNonRetryableError(
  message: string,
  constructor?: NonRetryableErrorConstructor,
): Error {
  return constructor
    ? new constructor(message, "NonRetryableError")
    : new NonRetryableError(message);
}

/** @internal Checks whether an unknown error is Sideffect's portable error. */
export function isSideffectNonRetryableError(error: unknown): error is NonRetryableError {
  return error instanceof NonRetryableError;
}

/** @internal Converts Sideffect's portable error to Cloudflare's native error. */
export function toNativeNonRetryableError(
  error: NonRetryableError,
  constructor: NonRetryableErrorConstructor,
): Error {
  return new constructor(error.message, error.name);
}
