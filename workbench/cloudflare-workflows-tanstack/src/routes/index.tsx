import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { workflowCases } from "../workflow-cases";

type WorkflowCase = (typeof workflowCases)[number];

type WorkflowRunState =
  | { readonly status: "running" }
  | { readonly status: "success"; readonly id: string; readonly details: unknown }
  | { readonly status: "error"; readonly message: string };

type WorkflowRunMap = Record<string, WorkflowRunState>;

export const Route = createFileRoute("/")({
  loader: () => workflowCases,
  component: Home,
});

function Home() {
  const cases = Route.useLoaderData();
  const [runs, setRuns] = useState<WorkflowRunMap>({});
  const hasRunningWorkflow = Object.values(runs).some((run) => run.status === "running");

  const handleTriggerWorkflow = async (key: string) => {
    setRuns((previous) => ({ ...previous, [key]: { status: "running" } }));
    const result = await createWorkflowRun(key);
    setRuns((previous) => ({ ...previous, [key]: result }));
  };

  const handleTriggerAll = async () => {
    setRuns((previous) => ({ ...previous, ...createRunningMap(cases) }));
    const results = await Promise.all(
      cases.map(async (entry) => [entry.key, await createWorkflowRun(entry.key)] as const),
    );

    setRuns((previous) => ({ ...previous, ...Object.fromEntries(results) }));
  };

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <main className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
              Sideffect Workbench
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              TanStack Start uses the shared Cloudflare Workflow matrix
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              These cases are the same workflow definitions used by the plain Vite workbench. The
              TanStack app adds API routes on top of the generated Cloudflare workflow bindings.
            </p>
          </div>

          <button
            className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            disabled={cases.length === 0 || hasRunningWorkflow}
            onClick={() => void handleTriggerAll()}
            type="button"
          >
            {hasRunningWorkflow ? "Running workflows..." : `Run all ${cases.length} workflows`}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((entry) => {
            const run = runs[entry.key];
            const isRunning = run?.status === "running";

            return (
              <article
                className="rounded-2xl border border-white/10 bg-white/4 p-5 shadow-2xl shadow-cyan-950/20"
                key={entry.key}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{entry.key}</h2>
                    <p className="mt-1 text-sm text-slate-400">{entry.className}</p>
                  </div>
                  <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                    {entry.binding}
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="rounded-lg bg-black/30 p-3 font-mono text-xs text-slate-300">
                    POST /api/e2e/workflows/{entry.key}
                  </p>
                  <button
                    className="rounded-full border border-cyan-300/30 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                    disabled={isRunning}
                    onClick={() => void handleTriggerWorkflow(entry.key)}
                    type="button"
                  >
                    {isRunning ? "Running..." : "Run workflow"}
                  </button>
                </div>

                <WorkflowRunResult run={run} />
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function WorkflowRunResult({ run }: { readonly run: WorkflowRunState | undefined }) {
  if (!run) {
    return <p className="mt-4 text-sm text-slate-500">Not triggered yet.</p>;
  }

  if (run.status === "running") {
    return <p className="mt-4 text-sm font-medium text-cyan-200">Starting workflow instance...</p>;
  }

  if (run.status === "error") {
    return (
      <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
        {run.message}
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3">
      <p className="text-sm font-medium text-emerald-100">Started instance {run.id}</p>
      <pre className="mt-3 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-5 text-emerald-50">
        {formatWorkflowDetails(run.details)}
      </pre>
    </div>
  );
}

function createRunningMap(cases: ReadonlyArray<WorkflowCase>): WorkflowRunMap {
  const runs: WorkflowRunMap = {};
  for (const entry of cases) {
    runs[entry.key] = { status: "running" };
  }

  return runs;
}

async function createWorkflowRun(key: string): Promise<WorkflowRunState> {
  try {
    const id = createWorkflowInstanceId(key);
    const response = await fetch(`/api/e2e/workflows/${key}?id=${encodeURIComponent(id)}`, {
      method: "POST",
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      return { status: "error", message: formatWorkflowError(key, response, body) };
    }

    if (!isRecord(body)) {
      return {
        status: "error",
        message: `Workflow ${key} was created, but the server returned an unreadable response. Check the worker logs for instance ${id}.`,
      };
    }

    return {
      status: "success",
      id: typeof body.id === "string" ? body.id : id,
      details: body.status ?? body,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? `Workflow ${key} was not started: ${error.message}`
          : `Workflow ${key} was not started because the browser reported an unknown error.`,
    };
  }
}

function createWorkflowInstanceId(key: string): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${key}-${randomId}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatWorkflowError(key: string, response: Response, body: unknown): string {
  if (isRecord(body) && typeof body.error === "string") {
    return `${body.error}. Workflow ${key} was not started.`;
  }

  if (typeof body === "string" && body.trim().length > 0) {
    return `Workflow ${key} was not started: ${body}`;
  }

  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return `Workflow ${key} was not started. The server returned ${response.status}${statusText}.`;
}

function formatWorkflowDetails(details: unknown): string {
  if (details === undefined) {
    return "No workflow status returned.";
  }

  if (typeof details === "string") {
    return details;
  }

  return JSON.stringify(details, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
