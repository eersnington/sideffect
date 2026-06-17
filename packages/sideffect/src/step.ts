import { Schema } from "effect";
import type { WorkflowStepContext, WorkflowStepRollbackOptions } from "cloudflare:workers";

import { decodeWithSchema, runMaybeEffect } from "./runtime.ts";
import type { RuntimeErrorOptions } from "./runtime.ts";
import type {
  RollbackHandler,
  StepDefinition,
  StepOptions,
  StepPayload,
  StepResult,
  DefaultCloudflareEnv,
} from "./types.ts";

/** Options for creating a reusable Sideffect step definition. */
export interface StepMakeOptions<Payload, Result, Env> {
  /** Schema used to decode the step payload before `run` executes. */
  readonly payload: Schema.Schema<Payload>;
  /** Schema used to decode the step result before it leaves the step. */
  readonly result: Schema.Schema<Result>;
  /** User function that performs the step work. */
  readonly run: StepDefinition<Payload, Result, Env>["run"];
}

/** Helpers for defining reusable typed workflow steps. */
export const Step = {
  /**
   * Creates a reusable typed step definition.
   *
   * Sideffect decodes the payload before `run` executes and decodes the result
   * before returning it to the workflow.
   *
   * @example
   * ```ts
   * const fetchImage = Step.make("fetch image", {
   *   payload: Schema.Struct({ imageId: Schema.String }),
   *   result: Schema.Struct({ id: Schema.String }),
   *   run: async ({ imageId }) => ({ id: imageId }),
   * });
   * ```
   */
  make<Payload, Result, Env = DefaultCloudflareEnv>(
    name: string,
    options: StepMakeOptions<Payload, Result, Env>,
  ): StepDefinition<Payload, Result, Env> {
    return makeStepDefinition({
      name,
      payloadSchema: options.payload,
      resultSchema: options.result,
      run: options.run,
    });
  },
};

/** @internal Creates the immutable step definition object used by public helpers. */
export function makeStepDefinition<Payload, Result, Env>(options: {
  readonly name: string;
  readonly payloadSchema: Schema.Schema<Payload>;
  readonly resultSchema: Schema.Schema<Result>;
  readonly run: StepDefinition<Payload, Result, Env>["run"];
  readonly rollback?: RollbackHandler<Payload, Result, Env>;
  readonly rollbackConfig?: StepDefinition<Payload, Result, Env>["rollbackConfig"];
}): StepDefinition<Payload, Result, Env> {
  return {
    _tag: "StepDefinition",
    name: options.name,
    payloadSchema: options.payloadSchema,
    resultSchema: options.resultSchema,
    run: options.run,
    rollback: options.rollback,
    rollbackConfig: options.rollbackConfig,
    pipe(fn) {
      return fn(this);
    },
  };
}

/** @internal Decodes a step payload and turns schema failures into workflow errors. */
export function decodeStepPayload<S extends StepDefinition<any, any>>(
  step: S,
  payload: StepPayload<S>,
  options?: RuntimeErrorOptions,
): StepPayload<S> {
  return decodeWithSchema(
    step.payloadSchema,
    payload,
    `Step "${step.name}" payload decoding`,
    options,
  ) as StepPayload<S>;
}

/** @internal Runs a step definition and validates both input and output schemas. */
export async function runStepDefinition<S extends StepDefinition<any, any>>(
  step: S,
  payload: StepPayload<S>,
  context: Parameters<S["run"]>[1],
  options?: RuntimeErrorOptions,
): Promise<StepResult<S>> {
  const decodedPayload = decodeStepPayload(step, payload, options);
  const result = await runMaybeEffect(step.run(decodedPayload, context));

  return decodeWithSchema(
    step.resultSchema,
    result,
    `Step "${step.name}" result decoding`,
    options,
  ) as StepResult<S>;
}

/**
 * @internal Selects the correct Cloudflare `step.do(...)` overload.
 *
 * Cloudflare supports configured/unconfigured steps and optional rollback
 * options. Keeping the overload routing here prevents the workflow engine from
 * duplicating that branching logic.
 */
export function callNativeStep<A>(
  nativeStep: { do: (...args: Array<any>) => Promise<A> },
  name: string,
  options: StepOptions | undefined,
  callback: (ctx: WorkflowStepContext) => Promise<A>,
  rollbackOptions?: WorkflowStepRollbackOptions<A>,
): Promise<A> {
  if (options === undefined) {
    return rollbackOptions === undefined
      ? nativeStep.do(name, callback)
      : nativeStep.do(name, callback, rollbackOptions);
  }

  return rollbackOptions === undefined
    ? nativeStep.do(name, options, callback)
    : nativeStep.do(name, options, callback, rollbackOptions);
}
