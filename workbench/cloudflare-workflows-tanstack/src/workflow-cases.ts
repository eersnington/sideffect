import { sharedWorkflowCases } from "cloudflare-workflows-shared";
import type { WorkflowCase } from "cloudflare-workflows-shared";

const nativeWorkflowCase = {
  key: "native-check",
  binding: "NATIVE_CHECK",
  className: "NativeCheck",
  params: { label: "native" },
} as const satisfies WorkflowCase;

export const workflowCases = [
  ...sharedWorkflowCases,
  nativeWorkflowCase,
] as const satisfies ReadonlyArray<WorkflowCase>;
