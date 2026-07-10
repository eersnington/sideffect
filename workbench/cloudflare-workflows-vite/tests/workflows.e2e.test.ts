import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

describe("Sideffect workflows", () => {
  test("composes synchronous and asynchronous steps", async () => {
    const status = await runWorkflow("add-numbers");

    expect(status.output).toEqual({ sum: 5, doubled: 10, formatted: "value:10" });
  });

  test("runs an ordinary async workflow", async () => {
    const status = await runWorkflow("normal-async");

    expect(status.output).toEqual({ echoed: { message: "hello", mode: "async" } });
  });

  test("runs an Effect-backed workflow", async () => {
    const status = await runWorkflow("effect-wrapped");

    expect(status.output).toEqual({ upper: "EFFECT" });
  });

  test("uses a Cloudflare binding from a Sideffect step", async () => {
    const status = await runWorkflow("binding-roundtrip");

    expect(status.output).toEqual({
      counter: { count: expect.any(Number) },
      metadata: { binding: "COUNTER", className: "Counter" },
    });
  });

  test("decodes a workflow payload before running steps", async () => {
    const status = await runWorkflow("payload-decoding");

    expect(status.output).toEqual({
      payload: { value: 42 },
      eventPayload: { value: 42 },
      decoded: { value: 42, label: "decoded:42" },
    });
  });

  test("passes Cloudflare step context to a Sideffect step", async () => {
    const status = await runWorkflow("step-context");

    expect(status.output).toEqual({
      label: "ctx",
      step: "read step context",
      attempt: expect.any(Number),
      timeout: "5 minutes",
    });
  });

  test("resumes after sleeping", async () => {
    const status = await runWorkflow("pause-and-return");

    expect(status.output).toEqual({ marker: "slept" });
  });

  test("runs a workflow created from an imported definition", async () => {
    const status = await runWorkflow("imported-definition");

    expect(status.output).toEqual({ echoed: { message: "imported", mode: "async" } });
  });

  test("discovers a directly exported default workflow", async () => {
    const status = await runWorkflow("default-direct");

    expect(status.output).toEqual({ marker: "default-direct" });
  });

  test("discovers a default-exported local layer", async () => {
    const status = await runWorkflow("default-local-layer");

    expect(status.output).toEqual({ echoed: { message: "default-local", mode: "async" } });
  });
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
  const id = `sideffect-${key}-${Date.now()}`;
  const response = await fetch(`${workbench.baseUrl}/api/workflows/${key}?id=${id}`, {
    method: "POST",
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id });

  return waitForWorkflow(`${workbench.baseUrl}/api/workflows/${key}?id=${id}`);
}
