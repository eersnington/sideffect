import type { Effect, Schema } from "effect";
import type {
  WorkflowEvent as CloudflareWorkflowEvent,
  WorkflowRollbackContext,
  WorkflowStepConfig,
  WorkflowStepContext,
  WorkflowStepEvent,
  WorkflowStepRollbackOptions,
} from "cloudflare:workers";

/** Value that may be returned directly, as a Promise, or as an Effect. */
export type MaybeEffect<A> = A | Promise<A> | Effect.Effect<A, unknown, never>;

/** Extracts the decoded TypeScript value from an Effect Schema. */
export type SchemaType<S> = S extends Schema.Schema<infer A> ? A : never;

/**
 * Cloudflare Workflow event with Sideffect's decoded payload type.
 *
 * Generated entrypoints preserve Cloudflare's event metadata while replacing
 * `payload` with the value decoded by the workflow payload schema.
 */
export type WorkflowEvent<Payload> = Readonly<Omit<CloudflareWorkflowEvent<Payload>, "payload">> & {
  readonly payload: Payload;
};

/** Context passed to a Sideffect workflow layer `run` function. */
export interface WorkflowContext<Payload> {
  /** Decoded workflow event payload. */
  readonly payload: Payload;
  /** Original Cloudflare event metadata with the decoded payload attached. */
  readonly event: WorkflowEvent<Payload>;
  /** Worker environment/bindings from the WorkflowEntrypoint instance. */
  readonly env: unknown;
  /** Worker execution context from the WorkflowEntrypoint instance. */
  readonly ctx: unknown;
}

/** Context passed to a Sideffect step definition. */
export interface StepContext extends WorkflowStepContext {
  /** Worker environment/bindings from the WorkflowEntrypoint instance. */
  readonly env: unknown;

  /** Worker execution context from the WorkflowEntrypoint instance. */
  readonly ctx: unknown;

  /** Raw Cloudflare WorkflowStep API object for advanced native operations. */
  readonly workflowStep: NativeWorkflowStep;
}

/** Cloudflare Workflow step options supported by Sideffect step execution. */
export interface StepOptions {
  /** Cloudflare retry configuration for the step. */
  readonly retries?: WorkflowStepConfig["retries"];
  /** Cloudflare timeout configuration for the step. */
  readonly timeout?: WorkflowStepConfig["timeout"];
  /** Whether Cloudflare should treat step logs/output as sensitive. */
  readonly sensitive?: WorkflowStepConfig["sensitive"];
}

/** Native Cloudflare Workflow step API shape used by Sideffect. */
export interface NativeWorkflowStep {
  /** Runs a Cloudflare Workflow step. */
  do<A>(name: string, callback: (context: WorkflowStepContext) => Promise<A> | A): Promise<A>;
  /** Runs a Cloudflare Workflow step with native rollback options. */
  do<A>(
    name: string,
    callback: (context: WorkflowStepContext) => Promise<A> | A,
    rollbackOptions: WorkflowStepRollbackOptions<A>,
  ): Promise<A>;
  /** Runs a configured Cloudflare Workflow step. */
  do<A>(
    name: string,
    config: StepOptions,
    callback: (context: WorkflowStepContext) => Promise<A> | A,
  ): Promise<A>;
  /** Runs a configured Cloudflare Workflow step with native rollback options. */
  do<A>(
    name: string,
    config: StepOptions,
    callback: (context: WorkflowStepContext) => Promise<A> | A,
    rollbackOptions: WorkflowStepRollbackOptions<A>,
  ): Promise<A>;
  /** Pauses the workflow for a Cloudflare duration string or millisecond count. */
  sleep(name: string, duration: string | number): Promise<void>;
  /** Pauses the workflow until the given timestamp. */
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
  /** Waits for a Cloudflare Workflow event. */
  waitForEvent<A = unknown>(
    name: string,
    options: { readonly type: string; readonly timeout?: string | number },
  ): Promise<WorkflowStepEvent<A>>;
}

/** Sideffect step helper passed to workflow layer `run` functions. */
export interface SideffectStep {
  /**
   * Runs a typed Sideffect step through Cloudflare's native step system.
   *
   * The payload and result are decoded with the step schemas, and failures to
   * decode are converted to non-retryable workflow failures.
   */
  do<const S extends StepDefinitionAny>(
    step: S,
    payload: StepPayload<S>,
    options?: StepOptions,
  ): Promise<StepResult<S>>;
  /** Forwards to Cloudflare `step.sleep()`. */
  sleep(name: string, duration: string | number): Promise<void>;
  /** Forwards to Cloudflare `step.sleepUntil()`. */
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
  /** Forwards to Cloudflare `step.waitForEvent()`. */
  waitForEvent<A = unknown>(
    name: string,
    options: { readonly type: string; readonly timeout?: string | number },
  ): Promise<WorkflowStepEvent<A>>;
}

/** Reusable typed step definition. */
export interface StepDefinition<Payload, Result> {
  /** Runtime tag used by Sideffect to validate step-like values. */
  readonly _tag: "StepDefinition";
  /** Cloudflare step name used when the step is executed. */
  readonly name: string;
  /** Schema used to decode step payloads before `run` executes. */
  readonly payloadSchema: Schema.Schema<Payload>;
  /** Schema used to decode step results before they leave the step. */
  readonly resultSchema: Schema.Schema<Result>;
  /** User function that performs the step work. */
  readonly run: (payload: Payload, context: StepContext) => MaybeEffect<Result>;
  /** Optional rollback handler forwarded to Cloudflare's native rollback system. */
  readonly rollback?: RollbackHandler<Payload, Result>;
  /** Optional Cloudflare rollback step configuration. */
  readonly rollbackConfig?: WorkflowStepConfig;
  /** Applies a transformation helper while preserving the step type. */
  pipe<A>(fn: (self: StepDefinition<Payload, Result>) => A): A;
}

/** @internal Any Sideffect step definition. */
export type StepDefinitionAny = StepDefinition<any, any>;

/** @internal Extracts the payload type from a step definition. */
export type StepPayload<S> = S extends StepDefinition<infer Payload, any> ? Payload : never;

/** @internal Extracts the result type from a step definition. */
export type StepResult<S> = S extends StepDefinition<any, infer Result> ? Result : never;

/** Context passed to a Sideffect rollback handler. */
export interface RollbackContext<Payload, Result> {
  /** Worker environment/bindings from the WorkflowEntrypoint instance. */
  readonly env: unknown;

  /** Worker execution context from the WorkflowEntrypoint instance. */
  readonly ctx: unknown;

  /** Raw Cloudflare WorkflowStep API object for advanced native operations. */
  readonly workflowStep: NativeWorkflowStep;

  /** Original step payload. */
  readonly payload: Payload;
  /** Step output from Cloudflare, or `undefined` if no output was available. */
  readonly result: Result | undefined;
  /** Failure that caused Cloudflare to invoke rollback. */
  readonly failure: unknown;
  /** Native Cloudflare rollback context. */
  readonly native: WorkflowRollbackContext<Result>;
}

/** Function that handles native Cloudflare rollback for a Sideffect step. */
export type RollbackHandler<Payload, Result> = (
  result: Result | undefined,
  context: RollbackContext<Payload, Result>,
) => MaybeEffect<void>;

/** Function that runs a Sideffect workflow layer. */
export type WorkflowRun<Payload, Result> = (
  workflow: WorkflowContext<Payload>,
  step: SideffectStep,
) => MaybeEffect<Result>;

/** Sideffect workflow definition created by `Workflow.make(...)`. */
export interface WorkflowDefinition<Payload> {
  /** Runtime tag used by Sideffect to validate workflow definitions. */
  readonly _tag: "WorkflowDefinition";
  /** Cloudflare Workflow name. */
  readonly name: string;
  /** Schema used to decode incoming workflow event payloads. */
  readonly payloadSchema: Schema.Schema<Payload>;
  /**
   * Binds a workflow definition to its implementation.
   *
   * The returned layer can be discovered by `withCloudflareWorkflows(...)` or
   * passed manually to `WorkflowEntrypoints.make(...)`.
   */
  toLayer<NextResult>(run: WorkflowRun<Payload, NextResult>): WorkflowLayer<Payload, NextResult>;
}

/** Runnable Sideffect workflow layer. */
export interface WorkflowLayer<Payload, Result = unknown> {
  /** Runtime tag used by Sideffect to validate workflow layers. */
  readonly _tag: "WorkflowLayer";
  /** Workflow definition and payload schema. */
  readonly workflow: WorkflowDefinition<Payload>;
  /** Workflow implementation. */
  readonly run: WorkflowRun<Payload, Result>;
}

/** @internal Any Sideffect workflow layer. */
export type WorkflowLayerAny = WorkflowLayer<any, any>;

/** @internal Named workflow layers used to generate Cloudflare entrypoints. */
export type WorkflowLayerEntries = Record<string, WorkflowLayerAny>;

/** @internal Constructor shape for Cloudflare `WorkflowEntrypoint`. */
export type WorkflowEntrypointConstructor = new (...args: Array<any>) => {
  readonly env?: unknown;
  readonly ctx?: unknown;
};

/** @internal Cloudflare workflow event before Sideffect payload decoding. */
export type CloudflareWorkflowEventAny = Readonly<CloudflareWorkflowEvent<unknown>>;

/** Wrangler workflow binding entry generated or merged by Sideffect. */
export interface WorkflowConfigEntry {
  /** Worker binding name exposed on `env`. */
  readonly binding: string;
  /** Cloudflare Workflow name. */
  readonly name: string;
  /** JavaScript export/class name for the WorkflowEntrypoint. */
  readonly class_name: string;
  /** Optional external Worker script name for native Cloudflare workflow bindings. */
  readonly script_name?: string;
  readonly [key: string]: unknown;
}
