import type { Effect, Schema } from "effect";
import type {
  WorkflowEvent as CloudflareWorkflowEvent,
  WorkflowStepConfig,
  WorkflowStepEvent,
} from "cloudflare:workers";

export type MaybeEffect<A> = A | Promise<A> | Effect.Effect<A, unknown, never>;

export type SchemaType<S> = S extends Schema.Schema<infer A> ? A : never;

export interface WorkflowEvent<Payload> {
  readonly payload: Payload;
  readonly timestamp?: Date | string | number;
  readonly instanceId?: string;
}

export interface WorkflowContext<Payload> {
  readonly payload: Payload;
  readonly event: WorkflowEvent<Payload>;
  readonly env: unknown;
  readonly ctx: unknown;
}

export interface StepContext {
  readonly env: unknown;
  readonly ctx: unknown;
  readonly step: NativeWorkflowStep;
}

export interface StepOptions {
  readonly retries?: WorkflowStepConfig["retries"];
  readonly timeout?: WorkflowStepConfig["timeout"];
  readonly sensitive?: WorkflowStepConfig["sensitive"];
}

export interface NativeWorkflowStep {
  do<A>(name: string, callback: () => Promise<A> | A): Promise<A>;
  do<A>(name: string, options: StepOptions, callback: () => Promise<A> | A): Promise<A>;
  sleep(name: string, duration: string | number): Promise<void>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
  waitForEvent<A = unknown>(
    name: string,
    options: { readonly type: string; readonly timeout?: string | number },
  ): Promise<WorkflowStepEvent<A>>;
}

export interface SideffectStep {
  do<const S extends StepDefinitionAny>(
    step: S,
    payload: StepPayload<S>,
    options?: StepOptions,
  ): Promise<StepResult<S>>;
  sleep(name: string, duration: string | number): Promise<void>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
  waitForEvent<A = unknown>(
    name: string,
    options: { readonly type: string; readonly timeout?: string | number },
  ): Promise<WorkflowStepEvent<A>>;
}

export interface StepDefinition<Payload, Result> {
  readonly _tag: "StepDefinition";
  readonly name: string;
  readonly payloadSchema: Schema.Schema<Payload>;
  readonly resultSchema: Schema.Schema<Result>;
  readonly run: (payload: Payload, context: StepContext) => MaybeEffect<Result>;
  readonly rollback?: RollbackHandler<Payload, Result>;
  pipe<A>(fn: (self: StepDefinition<Payload, Result>) => A): A;
}

export type StepDefinitionAny = StepDefinition<any, any>;

export type StepPayload<S> = S extends StepDefinition<infer Payload, any> ? Payload : never;

export type StepResult<S> = S extends StepDefinition<any, infer Result> ? Result : never;

export interface RollbackContext<Payload, Result> extends StepContext {
  readonly payload: Payload;
  readonly result: Result;
  readonly failure: unknown;
}

export type RollbackHandler<Payload, Result> = (
  result: Result,
  context: RollbackContext<Payload, Result>,
) => MaybeEffect<void>;

export type WorkflowRun<Payload, Result> = (
  workflow: WorkflowContext<Payload>,
  step: SideffectStep,
) => MaybeEffect<Result>;

export interface WorkflowDefinition<Payload> {
  readonly _tag: "WorkflowDefinition";
  readonly name: string;
  readonly payloadSchema: Schema.Schema<Payload>;
  toLayer<NextResult>(run: WorkflowRun<Payload, NextResult>): WorkflowLayer<Payload, NextResult>;
}

export interface WorkflowLayer<Payload, Result = unknown> {
  readonly _tag: "WorkflowLayer";
  readonly workflow: WorkflowDefinition<Payload>;
  readonly run: WorkflowRun<Payload, Result>;
}

export type WorkflowLayerAny = WorkflowLayer<any, any>;

export type WorkflowEntrypointConstructor = new (...args: Array<any>) => {
  readonly env?: unknown;
  readonly ctx?: unknown;
};

export type CloudflareWorkflowEventAny = CloudflareWorkflowEvent<unknown>;

export interface WorkflowBindingDescriptor {
  readonly module: string;
  readonly export: string;
  readonly className?: string;
}

export type WorkflowBindingDescriptors = Record<string, WorkflowBindingDescriptor>;

export interface WorkflowConfigEntry {
  readonly binding: string;
  readonly name: string;
  readonly class_name: string;
}
