import { createServer } from "vite";
import type { ViteDevServer } from "vite";

export interface WorkflowStatus {
  readonly status: string;
  readonly output?: unknown;
}

export interface RunningWorkbench {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

/** Starts a workbench through the same Vite development server used locally. */
export async function startWorkbench(root: string): Promise<RunningWorkbench> {
  const server: ViteDevServer = await createServer({ root, logLevel: "warn" });
  await server.listen(0);

  const baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  if (!baseUrl) {
    await server.close();
    throw new Error("Vite did not expose a local URL for the workflow workbench.");
  }

  return {
    baseUrl,
    close: () => server.close(),
  };
}

/** Polls a workflow instance until the local Cloudflare runtime completes it. */
export async function waitForWorkflow(
  url: string,
  options: {
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<WorkflowStatus> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;
  let latest: WorkflowStatus | undefined;

  while (Date.now() < deadline) {
    latest = await fetchWorkflowStatus(url);
    if (latest.status === "complete") {
      return latest;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Workflow did not complete within ${timeoutMs}ms. Last status: ${latest?.status ?? "unknown"}.`,
  );
}

async function fetchWorkflowStatus(url: string): Promise<WorkflowStatus> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with ${response.status}: ${await response.text()}`);
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("status" in body)) {
    throw new Error(`Request to ${url} returned an invalid workflow status.`);
  }

  if (typeof body.status !== "string") {
    throw new Error(`Request to ${url} returned a workflow status without a string state.`);
  }

  return {
    status: body.status,
    output: "output" in body ? body.output : undefined,
  };
}
