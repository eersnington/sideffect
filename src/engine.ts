import { decodeWithSchema, runMaybeEffect } from "./runtime.ts";
import { callNativeStep, runStepDefinition } from "./step.ts";
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

interface EngineRunOptions {
  readonly env: unknown;
  readonly ctx: unknown;
  readonly event: WorkflowEvent<unknown>;
  readonly step: NativeWorkflowStep;
}

export const WorkflowEngine = {
  make(
    exportName: string,
    layer: WorkflowLayerAny,
    WorkflowEntrypoint: WorkflowEntrypointConstructor,
  ) {
    return {
      [exportName]: class extends WorkflowEntrypoint {
        async run(event: CloudflareWorkflowEventAny, step: NativeWorkflowStep) {
          return WorkflowEngine.run(layer, {
            env: (this as { env?: unknown }).env,
            ctx: (this as { ctx?: unknown }).ctx,
            event: event as WorkflowEvent<unknown>,
            step,
          });
        }
      },
    }[exportName];
  },

  async run<Result>(layer: WorkflowLayerAny, options: EngineRunOptions): Promise<Result> {
    const payload = decodeWorkflowPayload(layer, options.event.payload);
    const sideffectStep = makeSideffectStep(options);

    return await runMaybeEffect(
      layer.run(
        {
          payload,
          event: options.event,
          env: options.env,
          ctx: options.ctx,
        },
        sideffectStep,
      ),
    );
  },
};

function decodeWorkflowPayload(layer: WorkflowLayerAny, payload: unknown): unknown {
  return decodeWithSchema(
    layer.workflow.payloadSchema,
    payload,
    `Workflow "${layer.workflow.name}" payload decoding`,
  );
}

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
        () =>
          runStepDefinition(step, payload, {
            env: options.env,
            ctx: options.ctx,
            step: options.step,
          }),
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
          step: options.step,
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
