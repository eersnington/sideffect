import { RollbackError } from "./errors.ts";
import { decodeWithSchema, runMaybeEffect } from "./runtime.ts";
import { callNativeStep, runStepDefinition } from "./step.ts";
import type {
  CloudflareWorkflowEventAny,
  NativeWorkflowStep,
  RollbackContext,
  SideffectStep,
  StepDefinitionAny,
  StepOptions,
  StepPayload,
  StepResult,
  WorkflowEntrypointConstructor,
  WorkflowEvent,
  WorkflowLayerAny,
} from "./types.ts";

interface EngineRunOptions {
  readonly env: unknown;
  readonly ctx: unknown;
  readonly event: WorkflowEvent<unknown>;
  readonly step: NativeWorkflowStep;
}

interface RollbackEntry {
  readonly step: StepDefinitionAny;
  readonly payload: unknown;
  readonly result: unknown;
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
    const rollbackStack: Array<RollbackEntry> = [];
    const sideffectStep = makeSideffectStep(options, rollbackStack);

    try {
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
    } catch (failure) {
      const rollbackFailures = await runRollbacks(rollbackStack, failure, options);
      if (rollbackFailures.length > 0) {
        throw new RollbackError(failure, rollbackFailures);
      }
      throw failure;
    }
  },
};

function decodeWorkflowPayload(layer: WorkflowLayerAny, payload: unknown): unknown {
  return decodeWithSchema(
    layer.workflow.payloadSchema,
    payload,
    `Workflow "${layer.workflow.name}" payload decoding`,
  );
}

function makeSideffectStep(
  options: EngineRunOptions,
  rollbackStack: Array<RollbackEntry>,
): SideffectStep {
  return {
    async do<S extends StepDefinitionAny>(
      step: S,
      payload: StepPayload<S>,
      stepOptions?: StepOptions,
    ): Promise<StepResult<S>> {
      const result = await callNativeStep(options.step, step.name, stepOptions, () =>
        runStepDefinition(step, payload, {
          env: options.env,
          ctx: options.ctx,
          step: options.step,
        }),
      );

      if (step.rollback) {
        rollbackStack.push({ step, payload, result });
      }

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

async function runRollbacks(
  rollbackStack: Array<RollbackEntry>,
  failure: unknown,
  options: EngineRunOptions,
): Promise<Array<unknown>> {
  const rollbackFailures: Array<unknown> = [];

  for (const entry of rollbackStack.toReversed()) {
    if (!entry.step.rollback) {
      continue;
    }

    try {
      await runMaybeEffect(
        entry.step.rollback(entry.result, {
          env: options.env,
          ctx: options.ctx,
          step: options.step,
          payload: entry.payload,
          result: entry.result,
          failure,
        } as RollbackContext<unknown, unknown>),
      );
    } catch (rollbackFailure) {
      rollbackFailures.push(rollbackFailure);
    }
  }

  return rollbackFailures;
}
