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
} from "./types.ts";

export interface StepMakeOptions<Payload, Result> {
  readonly payload: Schema.Schema<Payload>;
  readonly result: Schema.Schema<Result>;
  readonly run: StepDefinition<Payload, Result>["run"];
}

export const Step = {
  make<Payload, Result>(
    name: string,
    options: StepMakeOptions<Payload, Result>,
  ): StepDefinition<Payload, Result> {
    return makeStepDefinition({
      name,
      payloadSchema: options.payload,
      resultSchema: options.result,
      run: options.run,
    });
  },
};

export function makeStepDefinition<Payload, Result>(options: {
  readonly name: string;
  readonly payloadSchema: Schema.Schema<Payload>;
  readonly resultSchema: Schema.Schema<Result>;
  readonly run: StepDefinition<Payload, Result>["run"];
  readonly rollback?: RollbackHandler<Payload, Result>;
  readonly rollbackConfig?: StepDefinition<Payload, Result>["rollbackConfig"];
}): StepDefinition<Payload, Result> {
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
