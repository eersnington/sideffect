import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { makeWorkflowEntrypoints } from "./entrypoints.ts";
import type { WorkflowEntrypointConstructor, WorkflowLayerEntries } from "./types.ts";

export const WorkflowEntrypoints = {
  make<const Entries extends WorkflowLayerEntries>(entries: Entries) {
    return makeWorkflowEntrypoints(entries, {
      WorkflowEntrypoint: WorkflowEntrypoint as unknown as WorkflowEntrypointConstructor,
      NonRetryableError,
    });
  },
};
