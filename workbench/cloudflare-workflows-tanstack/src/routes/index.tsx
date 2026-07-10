import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { workflowCases } from "../workflow-cases";

type WorkflowCase = (typeof workflowCases)[number];
type WorkflowKey = WorkflowCase["key"];

type WorkflowRun =
  | { readonly state: "running" }
  | { readonly state: "success"; readonly id: string; readonly status: unknown }
  | { readonly state: "error"; readonly message: string };

type WorkflowRuns = Partial<Record<WorkflowKey, WorkflowRun>>;

export const Route = createFileRoute("/")({
  loader: () => workflowCases,
  component: Workbench,
});

function Workbench() {
  const workflows = Route.useLoaderData();
  const [runs, setRuns] = useState<WorkflowRuns>({});
  const isRunning = Object.values(runs).some((run) => run?.state === "running");

  const runWorkflow = async (workflow: WorkflowCase) => {
    setRuns((current) => ({ ...current, [workflow.key]: { state: "running" } }));
    const result = await startWorkflow(workflow.key);
    setRuns((current) => ({ ...current, [workflow.key]: result }));
  };

  const runAllWorkflows = async () => {
    setRuns(createRunningRuns(workflows));

    const results = await Promise.all(
      workflows.map(async (workflow) => [workflow.key, await startWorkflow(workflow.key)] as const),
    );

    setRuns(Object.fromEntries(results));
  };

  return (
    <div className="workbench-page">
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="#main-content" aria-label="Sideffect Workbench home">
            <span>Sideffect</span>
            <span className="brand__separator" aria-hidden="true" />
            <span className="brand__context">TanStack Start</span>
          </a>
          <span className="environment-badge">Local Workbench</span>
        </div>
      </header>

      <main className="workbench-main" id="main-content">
        <section className="hero" aria-labelledby="page-title">
          <div>
            <h1 id="page-title">Cloudflare Workflows</h1>
            <p className="hero__copy">
              Run the shared Sideffect examples through TanStack Start and inspect each Cloudflare
              workflow instance.
            </p>
          </div>

          <button
            className="button button--primary"
            disabled={isRunning}
            onClick={() => void runAllWorkflows()}
            type="button"
          >
            {isRunning ? "Running Workflows…" : `Run All ${workflows.length} Workflows`}
          </button>
        </section>

        <section className="workflow-panel" aria-labelledby="workflow-list-title">
          <div className="workflow-panel__header">
            <div>
              <h2 id="workflow-list-title">Workflow Examples</h2>
              <p>Discovered from the shared Sideffect workflow definitions.</p>
            </div>
            <span className="workflow-count">{workflows.length} workflows</span>
          </div>

          <div className="workflow-columns" aria-hidden="true">
            <span>Workflow</span>
            <span>Binding</span>
            <span>Status</span>
            <span />
          </div>

          <ul className="workflow-list">
            {workflows.map((workflow) => (
              <WorkflowRow
                key={workflow.key}
                workflow={workflow}
                run={runs[workflow.key]}
                onRun={() => void runWorkflow(workflow)}
              />
            ))}
          </ul>
        </section>

        <footer className="workbench-footer">
          <span>POST /api/workflows/:key</span>
          <span>Cloudflare Workers · Sideffect · TanStack Start</span>
        </footer>
      </main>
    </div>
  );
}

function WorkflowRow({
  workflow,
  run,
  onRun,
}: {
  readonly workflow: WorkflowCase;
  readonly run: WorkflowRun | undefined;
  readonly onRun: () => void;
}) {
  const state = run?.state ?? "idle";

  return (
    <li className="workflow-row" data-state={state}>
      <div className="workflow-row__summary">
        <div className="workflow-name">
          <strong>{workflow.key}</strong>
          <span>{workflow.className}</span>
        </div>

        <code className="binding-name" translate="no">
          {workflow.binding}
        </code>

        <WorkflowStatus run={run} />

        <button
          className="button button--secondary button--small"
          disabled={state === "running"}
          onClick={onRun}
          type="button"
        >
          {state === "running" ? "Starting…" : "Run Workflow"}
        </button>
      </div>

      <WorkflowResult run={run} />
    </li>
  );
}

function WorkflowStatus({ run }: { readonly run: WorkflowRun | undefined }) {
  const state = run?.state ?? "idle";
  const label =
    state === "idle"
      ? "Ready"
      : state === "running"
        ? "Starting…"
        : state === "success"
          ? "Started"
          : "Failed";

  return (
    <span className="status" data-state={state} aria-live="polite">
      <span className="status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function WorkflowResult({ run }: { readonly run: WorkflowRun | undefined }) {
  if (!run || run.state === "running") {
    return null;
  }

  if (run.state === "error") {
    return (
      <div className="workflow-result workflow-result--error" aria-live="polite">
        <strong>Workflow failed.</strong> {run.message}
      </div>
    );
  }

  return (
    <div className="workflow-result" aria-live="polite">
      <div className="workflow-result__meta">
        <span>Instance</span>
        <code translate="no">{run.id}</code>
      </div>
      <pre>{formatStatus(run.status)}</pre>
    </div>
  );
}

async function startWorkflow(key: WorkflowKey): Promise<WorkflowRun> {
  const id = `${key}-${crypto.randomUUID()}`;

  try {
    const response = await fetch(`/api/workflows/${key}?id=${encodeURIComponent(id)}`, {
      method: "POST",
    });

    if (!response.ok) {
      return {
        state: "error",
        message: `The server returned ${response.status}. Check the worker logs and try again.`,
      };
    }

    const created = parseCreatedWorkflow(await response.json());
    if (!created) {
      return {
        state: "error",
        message: "The server returned an invalid response. Check the worker logs and try again.",
      };
    }

    return { state: "success", id: created.id, status: created.status };
  } catch (error: unknown) {
    return {
      state: "error",
      message: error instanceof Error ? error.message : "The browser could not reach the worker.",
    };
  }
}

function parseCreatedWorkflow(
  value: unknown,
): { readonly id: string; readonly status: unknown } | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("status" in value)
  ) {
    return null;
  }

  return { id: value.id, status: value.status };
}

function createRunningRuns(workflows: ReadonlyArray<WorkflowCase>): WorkflowRuns {
  return Object.fromEntries(workflows.map((workflow) => [workflow.key, { state: "running" }]));
}

function formatStatus(status: unknown): string {
  return typeof status === "string" ? status : JSON.stringify(status, null, 2);
}
