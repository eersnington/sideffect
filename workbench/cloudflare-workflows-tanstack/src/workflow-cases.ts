import { sharedWorkflowCases } from "cloudflare-workflows-shared";
import type { SharedWorkflowCase } from "cloudflare-workflows-shared";

const nativeWorkflowCase = {
  key: "native-check",
  binding: "NATIVE_CHECK",
  className: "NativeCheck",
  params: { label: "native" },
} satisfies SharedWorkflowCase;

export const workflowCases = [
  ...sharedWorkflowCases,
  {
    ...nativeWorkflowCase,
  },
] satisfies Array<SharedWorkflowCase>;
