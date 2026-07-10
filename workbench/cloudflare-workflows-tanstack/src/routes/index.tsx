import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { workflowCases } from "../workflow-cases";

type WorkflowCase = (typeof workflowCases)[number];
type WorkflowKey = WorkflowCase["key"];

type WorkflowStatus = {
  readonly status: string;
  readonly output: unknown;
  readonly error: unknown;
};

type WorkflowRun =
  | { readonly state: "starting" }
  | { readonly state: "started"; readonly id: string; readonly status: WorkflowStatus }
  | { readonly state: "error" };

type WorkflowRuns = Partial<Record<WorkflowKey, WorkflowRun>>;

export const Route = createFileRoute("/")({
  loader: () => workflowCases,
  component: Workbench,
});

function Workbench() {
  const workflows = Route.useLoaderData();
  const [runs, setRuns] = useState<WorkflowRuns>({});
  const isRunning = Object.values(runs).some(isWorkflowRunning);

  const runWorkflow = async (workflow: WorkflowCase) => {
    const id = `${workflow.key}-${crypto.randomUUID()}`;
    setRuns((runs) => ({ ...runs, [workflow.key]: { state: "starting" } }));

    try {
      const startResponse = await fetch(
        `/api/workflows/${workflow.key}?id=${encodeURIComponent(id)}`,
        { method: "POST" },
      );
      if (!startResponse.ok) {
        setRuns((runs) => ({ ...runs, [workflow.key]: { state: "error" } }));
        return;
      }

      const created = await startResponse.json<{ readonly status: WorkflowStatus }>();
      let status = created.status;
      setRuns((runs) => ({ ...runs, [workflow.key]: { state: "started", id, status } }));

      while (isActiveStatus(status.status)) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        const statusResponse = await fetch(
          `/api/workflows/${workflow.key}?id=${encodeURIComponent(id)}`,
        );
        if (!statusResponse.ok) {
          setRuns((runs) => ({ ...runs, [workflow.key]: { state: "error" } }));
          return;
        }

        status = await statusResponse.json<WorkflowStatus>();
        setRuns((runs) => ({ ...runs, [workflow.key]: { state: "started", id, status } }));
      }
    } catch {
      setRuns((runs) => ({ ...runs, [workflow.key]: { state: "error" } }));
    }
  };

  const runAllWorkflows = async () => {
    await Promise.all(workflows.map(runWorkflow));
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
            {isRunning ? "Workflows Active…" : `Run All ${workflows.length} Workflows`}
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
  const isRunning = isWorkflowRunning(run);

  return (
    <li className="workflow-row">
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
          disabled={isRunning}
          onClick={onRun}
          type="button"
        >
          {run?.state === "starting" ? "Creating…" : isRunning ? "Checking…" : "Run Workflow"}
        </button>
      </div>

      <WorkflowResult run={run} />
    </li>
  );
}

function WorkflowStatus({ run }: { readonly run: WorkflowRun | undefined }) {
  let label = "Ready";
  let tone = "neutral";

  if (run?.state === "starting") {
    label = "Creating…";
    tone = "active";
  } else if (run?.state === "error") {
    label = "Failed";
    tone = "error";
  } else if (run?.state === "started") {
    label = run.status.status;
    tone = isActiveStatus(run.status.status) ? "active" : "neutral";

    if (run.status.status === "complete") {
      label = "Complete";
      tone = "success";
    } else if (run.status.status === "errored" || run.status.status === "terminated") {
      label = "Failed";
      tone = "error";
    }
  }

  return (
    <span className="status" data-tone={tone} aria-live="polite">
      <span className="status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function WorkflowResult({ run }: { readonly run: WorkflowRun | undefined }) {
  if (!run || run.state === "starting") {
    return null;
  }

  if (run.state === "error") {
    return (
      <div className="workflow-result workflow-result--error" aria-live="polite">
        The workflow request failed. Check the worker logs and try again.
      </div>
    );
  }

  if (isActiveStatus(run.status.status)) {
    return (
      <div className="workflow-result workflow-result--active" aria-live="polite">
        <WorkflowInstanceId id={run.id} />
        <p>The instance is active. Its status refreshes automatically.</p>
      </div>
    );
  }

  const className =
    run.status.status === "errored" || run.status.status === "terminated"
      ? "workflow-result workflow-result--error"
      : "workflow-result";

  return (
    <div className={className} aria-live="polite">
      <WorkflowInstanceId id={run.id} />
      <pre>{JSON.stringify(run.status, null, 2)}</pre>
    </div>
  );
}

function WorkflowInstanceId({ id }: { readonly id: string }) {
  return (
    <div className="workflow-result__meta">
      <span>Instance</span>
      <code translate="no">{id}</code>
    </div>
  );
}

function isWorkflowRunning(run: WorkflowRun | undefined): boolean {
  return (
    run?.state === "starting" || (run?.state === "started" && isActiveStatus(run.status.status))
  );
}

function isActiveStatus(status: string): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "waitingForPause" ||
    status === "unknown"
  );
}
