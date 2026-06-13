import { Effect, Schema } from "effect";

import { NonRetryableError } from "./errors.ts";
import type { MaybeEffect } from "./types.ts";

export async function runMaybeEffect<A>(value: MaybeEffect<A>): Promise<A> {
  return Effect.isEffect(value) ? Effect.runPromise(value) : await value;
}

export function decodeWithSchema<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  operation: string,
): A {
  try {
    return Schema.decodeUnknownSync(schema as never)(value) as A;
  } catch (cause) {
    throw new NonRetryableError(
      `${operation} failed because the value did not match its schema. The workflow will not retry this invalid input. Cause: ${String(cause)}`,
    );
  }
}
