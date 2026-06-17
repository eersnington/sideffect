import { Schema } from "effect";

import type {
  DefaultCloudflareEnv,
  WorkflowDefinition,
  WorkflowLayer,
  WorkflowRun,
} from "./types.ts";

/** Options for creating a Sideffect workflow definition. */
export interface WorkflowMakeOptions<Payload> {
  /** Cloudflare Workflow name. */
  readonly name: string;
  /** Schema used to decode incoming workflow event payloads. */
  readonly payload: Schema.Schema<Payload>;
}

/** Helpers for defining Sideffect workflows. */
export const Workflow = {
  /**
   * Creates a typed workflow definition.
   *
   * Use `toLayer(...)` on the returned definition to attach the workflow
   * implementation that Sideffect can discover or adapt to Cloudflare.
   *
   * @example
   * ```ts
   * const resizeImage = Workflow.make({
   *   name: "resize-image",
   *   payload: Schema.Struct({ imageId: Schema.String }),
   * });
   *
   * export const resizeImageLayer = resizeImage.toLayer(async ({ payload }, step) => {
   *   return await step.do(fetchImage, payload);
   * });
   * ```
   */
  make<Payload, Env = DefaultCloudflareEnv>(
    options: WorkflowMakeOptions<Payload>,
  ): WorkflowDefinition<Payload, Env> {
    const definition: WorkflowDefinition<Payload, Env> = {
      _tag: "WorkflowDefinition",
      name: options.name,
      payloadSchema: options.payload,
      toLayer<Result>(run: WorkflowRun<Payload, Result, Env>): WorkflowLayer<Payload, Result, Env> {
        return {
          _tag: "WorkflowLayer",
          workflow: definition,
          run,
        };
      },
    };

    return definition;
  },
};
