export interface NonRetryableErrorConstructor {
  new (message: string, name?: string): Error;
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function makeNonRetryableError(
  message: string,
  constructor?: NonRetryableErrorConstructor,
): Error {
  return constructor
    ? new constructor(message, "NonRetryableError")
    : new NonRetryableError(message);
}

export function isSideffectNonRetryableError(error: unknown): error is NonRetryableError {
  return error instanceof NonRetryableError;
}

export function toNativeNonRetryableError(
  error: NonRetryableError,
  constructor: NonRetryableErrorConstructor,
): Error {
  return new constructor(error.message, error.name);
}
