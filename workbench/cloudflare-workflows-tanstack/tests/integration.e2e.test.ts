import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedWorkflowCases } from "cloudflare-workflows-shared";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import {
  startWorkbench,
  waitForWorkflow,
} from "../../cloudflare-workflows-shared/test-support/workflow-http";
import type {
  RunningWorkbench,
  WorkflowStatus,
} from "../../cloudflare-workflows-shared/test-support/workflow-http";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let workbench: RunningWorkbench;

beforeAll(async () => {
  workbench = await startWorkbench(root);
});

afterAll(async () => {
  await workbench.close();
});

test("delegates application requests to TanStack Start", async () => {
  const response = await fetch(workbench.baseUrl);

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Cloudflare Workflows");
});

test("exposes the shared Sideffect workflows through the application API", async () => {
  const response = await fetch(`${workbench.baseUrl}/api/workflows`);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    ...sharedWorkflowCases,
    {
      key: "native-check",
      binding: "NATIVE_CHECK",
      className: "NativeCheck",
      params: { label: "native" },
    },
  ]);
});

test("runs a discovered Sideffect workflow inside TanStack Start", async () => {
  const status = await runWorkflow("add-numbers");

  expect(status.output).toEqual({ sum: 5, doubled: 10, formatted: "value:10" });
});

test("runs an application-owned native Cloudflare workflow", async () => {
  const status = await runWorkflow("native-check");

  expect(status.output).toEqual({ label: "native", mode: "native" });
});

describe("workflow HTTP API", () => {
  test("returns 404 for an unknown workflow", async () => {
    const response = await fetch(`${workbench.baseUrl}/api/workflows/not-registered`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Unknown workflow case not-registered" });
  });

  test("requires an instance ID when reading status", async () => {
    const response = await fetch(`${workbench.baseUrl}/api/workflows/add-numbers`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing workflow instance id" });
  });

  test("rejects unsupported methods", async () => {
    const response = await fetch(`${workbench.baseUrl}/api/workflows/add-numbers`, {
      method: "DELETE",
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Unsupported method DELETE" });
  });
});

async function runWorkflow(key: string): Promise<WorkflowStatus> {
  const id = `sideffect-tanstack-${key}-${Date.now()}`;
  const response = await fetch(`${workbench.baseUrl}/api/workflows/${key}?id=${id}`, {
    method: "POST",
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id });

  return waitForWorkflow(`${workbench.baseUrl}/api/workflows/${key}?id=${id}`);
}
