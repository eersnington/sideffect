import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { makeWorkflowEntrypoints } from "./entrypoints.ts";
import type { WorkflowEntrypointConstructor, WorkflowLayerEntries } from "./types.ts";

/** Manual adapter for turning Sideffect workflow layers into Cloudflare entrypoints. */
export const WorkflowEntrypoints = {
  /**
   * Creates named Cloudflare `WorkflowEntrypoint` exports from Sideffect layers.
   *
   * Vite users usually prefer `withCloudflareWorkflows(...)` from
   * `sideffect/vite`, which discovers layers and generates these entrypoints
   * automatically. Use this helper for manual/native Cloudflare Worker setups.
   *
   * @example
   * ```ts
   * import { WorkflowEntrypoints } from "sideffect/cloudflare";
   * import { resizeImageLayer } from "./workflows/resize-image";
   *
   * export const { ResizeImage } = WorkflowEntrypoints.make({
   *   ResizeImage: resizeImageLayer,
   * });
   * ```
   */
  make<const Entries extends WorkflowLayerEntries>(entries: Entries) {
    return makeWorkflowEntrypoints(entries, {
      WorkflowEntrypoint: WorkflowEntrypoint as unknown as WorkflowEntrypointConstructor,
      NonRetryableError,
    });
  },
};
