import { Effect, Schema } from "effect";

import { makeNonRetryableError } from "./errors.ts";
import type { NonRetryableErrorConstructor } from "./errors.ts";
import type { MaybeEffect } from "./types.ts";

const schemaDecoders = new WeakMap<object, (value: unknown) => unknown>();

/** @internal Runtime options used when converting expected failures. */
export interface RuntimeErrorOptions {
  /** Optional native Cloudflare `NonRetryableError` constructor. */
  readonly NonRetryableError?: NonRetryableErrorConstructor;
}

/** @internal Resolves a direct value, Promise, or Effect into a Promise. */
export async function runMaybeEffect<A>(value: MaybeEffect<A>): Promise<A> {
  return Effect.isEffect(value) ? Effect.runPromise(value) : await value;
}

/**
 * @internal Decodes a value with an Effect Schema.
 *
 * Schema failures represent invalid workflow data, so they are converted to
 * non-retryable workflow errors instead of retryable exceptions.
 */
export function decodeWithSchema<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  operation: string,
  options: RuntimeErrorOptions = {},
): A {
  try {
    return decoderFor(schema)(value) as A;
  } catch (cause) {
    throw makeNonRetryableError(
      `${operation} failed because the value did not match its schema. The workflow will not retry this invalid input. Cause: ${String(cause)}`,
      options.NonRetryableError,
    );
  }
}

function decoderFor<A>(schema: Schema.Schema<A>): (value: unknown) => A {
  const cached = schemaDecoders.get(schema);
  if (cached) {
    return cached as (value: unknown) => A;
  }

  const decoder = Schema.decodeUnknownSync(schema as never) as (value: unknown) => A;
  schemaDecoders.set(schema, decoder);
  return decoder;
}
