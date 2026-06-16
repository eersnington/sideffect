import { decodeWithSchema, runMaybeEffect } from "./runtime.ts";
import { callNativeStep, runStepDefinition } from "./step.ts";
import { isSideffectNonRetryableError, toNativeNonRetryableError } from "./errors.ts";
import type { NonRetryableErrorConstructor } from "./errors.ts";
import type {
  CloudflareWorkflowEventAny,
  NativeWorkflowStep,
  SideffectStep,
  StepDefinitionAny,
  StepOptions,
  StepPayload,
  StepResult,
  WorkflowEntrypointConstructor,
  WorkflowEvent,
  WorkflowLayerAny,
} from "./types.ts";
import type { WorkflowRollbackContext, WorkflowStepRollbackOptions } from "cloudflare:workers";

/** @internal Inputs needed to execute a workflow layer inside Cloudflare. */
interface EngineRunOptions {
  /** Worker environment/bindings from the WorkflowEntrypoint instance. */
  readonly env: unknown;
  /** Worker execution context from the WorkflowEntrypoint instance. */
  readonly ctx: unknown;
  /** Native Cloudflare workflow event before payload decoding. */
  readonly event: CloudflareWorkflowEventAny;
  /** Native Cloudflare workflow step API. */
  readonly step: NativeWorkflowStep;
  /** Optional Cloudflare native `NonRetryableError` constructor. */
  readonly NonRetryableError?: NonRetryableErrorConstructor;
}

/** @internal Options for constructing generated workflow entrypoint classes. */
interface EngineMakeOptions {
  /** Optional Cloudflare native `NonRetryableError` constructor. */
  readonly NonRetryableError?: NonRetryableErrorConstructor;
}

/**
 * Workers SDK treats workflow non-retryable failures by error name/message,
 * not native constructor identity. We convert at the generated workflow
 * boundary; step and rollback callbacks can keep the portable class as long as
 * its name remains "NonRetryableError".
 */
/** @internal Re-throws portable non-retryable errors as native Cloudflare errors. */
function convertSideffectNonRetryableError(
  error: unknown,
  constructor: NonRetryableErrorConstructor | undefined,
): never {
  if (constructor && isSideffectNonRetryableError(error)) {
    throw toNativeNonRetryableError(error, constructor);
  }

  throw error;
}

/**
 * Low-level runtime bridge used by generated Cloudflare entrypoints.
 *
 * Most users should prefer `Workflow.make(...)`, `Step.make(...)`, and either
 * `withCloudflareWorkflows(...)` or `WorkflowEntrypoints.make(...)`.
 */
export const WorkflowEngine = {
  /** Creates a Cloudflare `WorkflowEntrypoint` subclass for one Sideffect layer. */
  make(
    exportName: string,
    layer: WorkflowLayerAny,
    WorkflowEntrypoint: WorkflowEntrypointConstructor,
    makeOptions: EngineMakeOptions = {},
  ) {
    return {
      [exportName]: class extends WorkflowEntrypoint {
        async run(event: CloudflareWorkflowEventAny, step: NativeWorkflowStep) {
          return WorkflowEngine.run(layer, {
            env: (this as { env?: unknown }).env,
            ctx: (this as { ctx?: unknown }).ctx,
            event,
            step,
            NonRetryableError: makeOptions.NonRetryableError,
          });
        }
      },
    }[exportName];
  },

  /** Runs a Sideffect workflow layer with a native Cloudflare event and step API. */
  async run<Result>(layer: WorkflowLayerAny, options: EngineRunOptions): Promise<Result> {
    const payload = decodeWorkflowPayload(layer, options.event.payload, options);
    const event = { ...options.event, payload } as WorkflowEvent<unknown>;
    const sideffectStep = makeSideffectStep(options);

    try {
      return await runMaybeEffect(
        layer.run(
          {
            payload,
            event,
            env: options.env,
            ctx: options.ctx,
          },
          sideffectStep,
        ),
      );
    } catch (error) {
      convertSideffectNonRetryableError(error, options.NonRetryableError);
    }
  },
};

/** @internal Decodes a native Cloudflare workflow event payload. */
function decodeWorkflowPayload(
  layer: WorkflowLayerAny,
  payload: unknown,
  options: EngineRunOptions,
): unknown {
  return decodeWithSchema(
    layer.workflow.payloadSchema,
    payload,
    `Workflow "${layer.workflow.name}" payload decoding`,
    { NonRetryableError: options.NonRetryableError },
  );
}

/** @internal Creates the typed Sideffect step facade passed to workflow code. */
function makeSideffectStep(options: EngineRunOptions): SideffectStep {
  return {
    async do<S extends StepDefinitionAny>(
      step: S,
      payload: StepPayload<S>,
      stepOptions?: StepOptions,
    ): Promise<StepResult<S>> {
      const result = await callNativeStep(
        options.step,
        step.name,
        stepOptions,
        (ctx) =>
          runStepDefinition(
            step,
            payload,
            {
              ...ctx,
              env: options.env,
              ctx: options.ctx,
              workflowStep: options.step,
            },
            {
              NonRetryableError: options.NonRetryableError,
            },
          ),
        makeRollbackOptions(step, payload, options),
      );

      return result as StepResult<S>;
    },

    sleep(name, duration) {
      return options.step.sleep(name, duration);
    },

    sleepUntil(name, timestamp) {
      return options.step.sleepUntil(name, timestamp);
    },

    waitForEvent(name, eventOptions) {
      return options.step.waitForEvent(name, eventOptions);
    },
  };
}

/** @internal Builds native Cloudflare rollback options for a Sideffect step. */
function makeRollbackOptions(
  step: StepDefinitionAny,
  payload: unknown,
  options: EngineRunOptions,
): WorkflowStepRollbackOptions<unknown> | undefined {
  const rollback = step.rollback;

  if (!rollback) {
    return undefined;
  }

  return {
    rollback: async (native: WorkflowRollbackContext<unknown>) => {
      await runMaybeEffect(
        rollback(native.output, {
          env: options.env,
          ctx: options.ctx,
          workflowStep: options.step,
          payload,
          result: native.output,
          failure: native.error,
          native,
        }),
      );
    },
    rollbackConfig: step.rollbackConfig,
  };
}
