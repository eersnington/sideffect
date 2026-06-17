import { makeStepDefinition } from "./step.ts";
import type { WorkflowStepConfig } from "cloudflare:workers";
import type { DefaultCloudflareEnv, RollbackHandler, StepDefinition } from "./types.ts";

/** Helpers for attaching native Cloudflare rollback handlers to steps. */
export const Rollback = {
  /**
   * Attaches a rollback handler to a Sideffect step definition.
   *
   * Cloudflare owns rollback execution. Sideffect forwards this handler and the
   * optional rollback step config to Cloudflare's native step rollback mechanism.
   *
   * @example
   * ```ts
   * const fetchImageWithRollback = fetchImage.pipe(
   *   Rollback.with(async (_result, { payload, failure }) => {
   *     console.log("rolling back", payload.imageId, failure);
   *   }),
   * );
   * ```
   */
  with<Payload, Result, Env = DefaultCloudflareEnv>(
    handler: RollbackHandler<Payload, Result, Env>,
    config?: WorkflowStepConfig,
  ) {
    return (step: StepDefinition<Payload, Result, Env>): StepDefinition<Payload, Result, Env> =>
      makeStepDefinition({
        name: step.name,
        payloadSchema: step.payloadSchema,
        resultSchema: step.resultSchema,
        run: step.run,
        rollback: handler,
        rollbackConfig: config,
      });
  },
};
