import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedWorkflowCases } from "cloudflare-workflows-shared";
import { beforeAll, describe, expect, test } from "vite-plus/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist/server");
const expectedWorkflows = [
  { binding: "NATIVE_CHECK", name: "native-check", class_name: "NativeCheck" },
  ...sharedWorkflowCases.map((workflow) => ({
    binding: workflow.binding,
    name: workflow.key,
    class_name: workflow.className,
  })),
];

beforeAll(() => {
  execFileSync("bun", ["run", "build"], { cwd: root, encoding: "utf8", stdio: "pipe" });
});

describe("workflow discovery in the TanStack SSR environment", () => {
  test("generates Sideffect and native Cloudflare bindings", () => {
    const config: unknown = JSON.parse(readFileSync(join(dist, "wrangler.json"), "utf8"));

    expect(config).toMatchObject({
      workflows: expectedWorkflows,
      durable_objects: {
        bindings: [{ name: "COUNTER", class_name: "Counter" }],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["Counter"] }],
    });
  });

  test("includes every discovered workflow in the server bundle", () => {
    const bundle = readFileSync(join(dist, "index.js"), "utf8");

    for (const workflow of expectedWorkflows) {
      expect(bundle).toContain(workflow.class_name);
    }
  });

  test("produces a Wrangler-compatible TanStack worker", () => {
    const output = execFileSync("bun", ["x", "wrangler", "deploy", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });

    expect(output).toContain("--dry-run");
  });
});
