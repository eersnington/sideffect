import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedWorkflowCases } from "cloudflare-workflows-shared";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

interface E2eCase {
  readonly key: string;
  readonly binding: string;
  readonly className: string;
  readonly params: unknown;
}

interface WorkflowStatus {
  readonly status: string;
  readonly output?: unknown;
  readonly __LOCAL_DEV_STEP_OUTPUTS?: Array<{ readonly output?: unknown }>;
}

interface WranglerConfig {
  readonly workflows?: Array<{
    readonly binding: string;
    readonly name: string;
    readonly class_name: string;
  }>;
  readonly durable_objects?: {
    readonly bindings?: Array<{ readonly name: string; readonly class_name: string }>;
  };
  readonly migrations?: Array<{
    readonly tag: string;
    readonly new_sqlite_classes?: Array<string>;
  }>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist/sideffect_cloudflare_workflows_vite");
const expectedWorkflows = [
  ...sharedWorkflowCases.map((entry) => ({
    binding: entry.binding,
    name: entry.key,
    class_name: entry.className,
  })),
  { binding: "NATIVE_CHECK", name: "native-check", class_name: "NativeCheck" },
];

let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

test("Cloudflare Vite dev server runs discovered Sideffect workflows", async () => {
  server = await createServer({ root, logLevel: "warn" });
  await server.listen(0);

  const baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      "Vite did not expose a local dev server URL for the Cloudflare workflow E2E fixture.",
    );
  }

  const counter = await fetchJson<{ readonly count: number }>(`${baseUrl}/counter`);
  expect(counter.count).toBeGreaterThan(0);

  const cases = await fetchJson<Array<E2eCase>>(`${baseUrl}/e2e/workflows`);
  expect(cases.map((entry) => entry.binding).sort()).toEqual(
    expectedWorkflows.map((entry) => entry.binding).sort(),
  );

  for (const e2eCase of cases) {
    const id = `sideffect-${e2eCase.key}-${Date.now()}`;
    await fetchJson(`${baseUrl}/e2e/workflows/${e2eCase.key}/create?id=${id}`);
    const status = await pollWorkflowStatus(baseUrl, e2eCase.key, id);

    expect(status.status).toBe("complete");
    expectWorkflowOutput(e2eCase.key, status.output);
  }
});

test("Cloudflare Vite build emits workflow config and Wrangler dry-run accepts it", () => {
  rmSync(dist, { recursive: true, force: true });
  execFileSync("bun", ["run", "build"], { cwd: root, encoding: "utf8", stdio: "pipe" });

  const config = JSON.parse(readFileSync(join(dist, "wrangler.json"), "utf8")) as WranglerConfig;
  expect(config.workflows?.sort(byBinding)).toEqual([...expectedWorkflows].sort(byBinding));
  expect(config.durable_objects?.bindings).toEqual([{ name: "COUNTER", class_name: "Counter" }]);
  expect(config.migrations).toEqual([{ tag: "v1", new_sqlite_classes: ["Counter"] }]);

  const bundle = readFileSync(join(dist, "index.js"), "utf8");
  for (const workflow of expectedWorkflows) {
    expect(bundle).toContain(workflow.class_name);
  }
  expect(bundle).toContain("export { AddNumbers");
  expect(bundle).toContain("Counter");
  expect(bundle).toContain("NativeCheck");
  expect(bundle).toContain("default");

  const dryRun = execFileSync("bun", ["x", "wrangler", "deploy", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  expect(dryRun).toContain("--dry-run");
});

async function pollWorkflowStatus(
  baseUrl: string,
  key: string,
  id: string,
): Promise<WorkflowStatus> {
  let latest: WorkflowStatus | undefined;
  await vi.waitFor(
    async () => {
      latest = await fetchJson<WorkflowStatus>(`${baseUrl}/e2e/workflows/${key}/status?id=${id}`);
      expect(latest.status).toBe("complete");
    },
    { interval: 500, timeout: 20_000 },
  );

  if (!latest) {
    throw new Error(`Workflow ${key} did not return a status payload.`);
  }

  return latest;
}

async function fetchJson<A>(url: string): Promise<A> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function expectWorkflowOutput(key: string, output: unknown) {
  switch (key) {
    case "add-numbers":
      expect(output).toEqual({ sum: 5, doubled: 10, formatted: "value:10" });
      return;
    case "normal-async":
      expect(output).toEqual({ echoed: { message: "hello", mode: "async" } });
      return;
    case "effect-wrapped":
      expect(output).toEqual({ upper: "EFFECT" });
      return;
    case "binding-roundtrip":
      expect(output).toEqual({
        counter: { count: expect.any(Number) },
        metadata: { binding: "COUNTER", className: "Counter" },
      });
      return;
    case "payload-decoding":
      expect(output).toEqual({
        payload: { value: 42 },
        eventPayload: { value: 42 },
        decoded: { value: 42, label: "decoded:42" },
      });
      return;
    case "step-context":
      expect(output).toEqual({
        label: "ctx",
        step: "read step context",
        attempt: expect.any(Number),
        timeout: "5 minutes",
      });
      return;
    case "pause-and-return":
      expect(output).toEqual({ marker: "slept" });
      return;
    case "native-check":
      expect(output).toEqual({ label: "native", mode: "native" });
      return;
    default:
      throw new Error(`Unexpected workflow E2E case ${key}.`);
  }
}

function byBinding(
  left: { readonly binding: string },
  right: { readonly binding: string },
): number {
  return left.binding.localeCompare(right.binding);
}
