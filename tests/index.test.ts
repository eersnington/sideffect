import { Effect } from "effect";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

import {
  NonRetryableError,
  Rollback,
  RollbackError,
  Schema,
  Step,
  TaggedError,
  Workflow,
  WorkflowEngine,
} from "../src/index.ts";
import { makeWorkflowEntrypoints } from "../src/entrypoints.ts";
import {
  collectWorkflowEntries,
  createSideffectWorkflowsPlugin,
  workflowConfigEntries,
  withCloudflareWorkflows,
} from "../src/vite.ts";
import type { NativeWorkflowStep, WorkflowEntrypointConstructor } from "../src/types.ts";
import type { SideffectWorkflowsPlugin } from "../src/vite.ts";

class MissingImage extends TaggedError("MissingImage")<{
  readonly imageId: string;
}> {}

const imageWorkflow = Workflow.make({
  name: "image-workflow",
  payload: Schema.Struct({ imageId: Schema.String }),
});

const fetchImage = Step.make("fetch image", {
  payload: Schema.Struct({ imageId: Schema.String }),
  result: Schema.Struct({ id: Schema.String }),
  run: async ({ imageId }) => {
    if (imageId === "missing") {
      throw new MissingImage({ imageId });
    }

    return { id: imageId };
  },
});

function fakeNativeStep(calls: Array<unknown> = []): NativeWorkflowStep {
  return {
    async do(...args: Array<unknown>) {
      calls.push(args.slice(0, -1));
      const callback = args.at(-1) as () => Promise<unknown>;
      return callback();
    },
    async sleep(name, duration) {
      calls.push(["sleep", name, duration]);
    },
    async sleepUntil(name, timestamp) {
      calls.push(["sleepUntil", name, timestamp]);
    },
    async waitForEvent<A>(name: string, options: { readonly type: string }) {
      calls.push(["waitForEvent", name, options]);
      return {
        payload: { ok: true } as A,
        timestamp: new Date(0),
        type: options.type,
      };
    },
  };
}

function callConfigResolved(plugin: SideffectWorkflowsPlugin, config: { readonly root: string }) {
  const hook = (plugin as any)["configResolved"];
  return typeof hook === "function" ? hook(config) : hook?.handler?.(config);
}

function callResolveId(plugin: SideffectWorkflowsPlugin, source: string) {
  const hook = (plugin as any)["resolveId"];
  return typeof hook === "function"
    ? hook.call({}, source, undefined, {})
    : hook?.handler?.call({}, source, undefined, {});
}

function callLoad(
  plugin: SideffectWorkflowsPlugin,
  context: {
    readonly resolve: (source: string, importer: string) => Promise<{ id: string } | null>;
  },
) {
  const hook = (plugin as any)["load"];
  return typeof hook === "function"
    ? hook.call(context, "\0virtual:sideffect/entry")
    : hook?.handler?.call(context, "\0virtual:sideffect/entry");
}

function withTempProject<A>(files: Record<string, string>, run: (root: string) => A): A {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "sideffect-"));
  let cleanup = true;
  try {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(root, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, { flag: "w" });
    }

    const result = run(root);
    if (isPromiseLike(result)) {
      cleanup = false;
      return result.finally(() => rmSync(root, { recursive: true, force: true })) as A;
    }

    return result;
  } finally {
    if (cleanup) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "finally" in value;
}

test("workflow engine runs an async workflow through native step.do", async () => {
  const calls: Array<unknown> = [];
  const layer = imageWorkflow.toLayer(async (workflow, step) => {
    return step.do(fetchImage, { imageId: workflow.payload.imageId });
  });

  const result = await WorkflowEngine.run(layer, {
    env: {},
    ctx: {},
    event: { payload: { imageId: "img_123" } },
    step: fakeNativeStep(calls),
  });

  expect(result).toEqual({ id: "img_123" });
  expect(calls).toEqual([["fetch image"]]);
});

test("workflow engine preserves tagged errors from async steps", async () => {
  const layer = imageWorkflow.toLayer(async (workflow, step) => {
    return step.do(fetchImage, { imageId: workflow.payload.imageId });
  });

  await expect(
    WorkflowEngine.run(layer, {
      env: {},
      ctx: {},
      event: { payload: { imageId: "missing" } },
      step: fakeNativeStep(),
    }),
  ).rejects.toBeInstanceOf(MissingImage);
});

test("workflow engine accepts Effect workflow bodies and preserves catchTag", async () => {
  const layer = imageWorkflow.toLayer(
    Effect.fn(function* (workflow, step) {
      return yield* Effect.tryPromise({
        try: () => step.do(fetchImage, { imageId: workflow.payload.imageId }),
        catch: (error) => error as MissingImage,
      }).pipe(
        Effect.catchTag("MissingImage", (error) =>
          Effect.fail(new NonRetryableError(`Missing ${error.imageId}`)),
        ),
      );
    }),
  );

  await expect(
    WorkflowEngine.run(layer, {
      env: {},
      ctx: {},
      event: { payload: { imageId: "missing" } },
      step: fakeNativeStep(),
    }),
  ).rejects.toBeInstanceOf(NonRetryableError);
});

test("step.do forwards Cloudflare retry and timeout options", async () => {
  const calls: Array<unknown> = [];
  const layer = imageWorkflow.toLayer(async (workflow, step) => {
    return step.do(
      fetchImage,
      { imageId: workflow.payload.imageId },
      { retries: { limit: 3, delay: "10 seconds" }, timeout: "5 minutes" },
    );
  });

  await WorkflowEngine.run(layer, {
    env: {},
    ctx: {},
    event: { payload: { imageId: "img_123" } },
    step: fakeNativeStep(calls),
  });

  expect(calls).toEqual([
    ["fetch image", { retries: { limit: 3, delay: "10 seconds" }, timeout: "5 minutes" }],
  ]);
});

test("invalid workflow payload becomes NonRetryableError", async () => {
  const layer = imageWorkflow.toLayer(async () => undefined);

  await expect(
    WorkflowEngine.run(layer, {
      env: {},
      ctx: {},
      event: { payload: { imageId: 123 } },
      step: fakeNativeStep(),
    }),
  ).rejects.toBeInstanceOf(NonRetryableError);
});

test("rollback handlers run in reverse order and keep original failure", async () => {
  const rollbacks: Array<string> = [];
  const first = Step.make("first", {
    payload: Schema.String,
    result: Schema.String,
    run: (value) => value,
  }).pipe(
    Rollback.with((result) => {
      rollbacks.push(`first:${result}`);
    }),
  );
  const second = Step.make("second", {
    payload: Schema.String,
    result: Schema.String,
    run: (value) => value,
  }).pipe(
    Rollback.with((result) => {
      rollbacks.push(`second:${result}`);
    }),
  );
  const failure = new Error("boom");
  const layer = imageWorkflow.toLayer(async (_workflow, step) => {
    await step.do(first, "a");
    await step.do(second, "b");
    throw failure;
  });

  await expect(
    WorkflowEngine.run(layer, {
      env: {},
      ctx: {},
      event: { payload: { imageId: "img_123" } },
      step: fakeNativeStep(),
    }),
  ).rejects.toBe(failure);
  expect(rollbacks).toEqual(["second:b", "first:a"]);
});

test("rollback failures are reported with explicit rollback error", async () => {
  const rollbackFailure = new Error("rollback failed");
  const stepWithFailingRollback = Step.make("step with failing rollback", {
    payload: Schema.String,
    result: Schema.String,
    run: (value) => value,
  }).pipe(
    Rollback.with(() => {
      throw rollbackFailure;
    }),
  );
  const workflowFailure = new Error("workflow failed");
  const layer = imageWorkflow.toLayer(async (_workflow, step) => {
    await step.do(stepWithFailingRollback, "value");
    throw workflowFailure;
  });

  try {
    await WorkflowEngine.run(layer, {
      env: {},
      ctx: {},
      event: { payload: { imageId: "img_123" } },
      step: fakeNativeStep(),
    });
    throw new Error("Expected workflow to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RollbackError);
    expect((error as RollbackError).failure).toBe(workflowFailure);
    expect((error as RollbackError).rollbackFailures).toEqual([rollbackFailure]);
  }
});

test("sleep, sleepUntil, and waitForEvent delegate to native WorkflowStep", async () => {
  const calls: Array<unknown> = [];
  const date = new Date(0);
  const layer = imageWorkflow.toLayer(async (_workflow, step) => {
    await step.sleep("pause", "1 second");
    await step.sleepUntil("until", date);
    return step.waitForEvent<{ ok: boolean }>("wait", { type: "done", timeout: "5 minutes" });
  });

  const result = await WorkflowEngine.run(layer, {
    env: {},
    ctx: {},
    event: { payload: { imageId: "img_123" } },
    step: fakeNativeStep(calls),
  });

  expect(result).toEqual({ payload: { ok: true }, timestamp: new Date(0), type: "done" });
  expect(calls).toEqual([
    ["sleep", "pause", "1 second"],
    ["sleepUntil", "until", date],
    ["waitForEvent", "wait", { type: "done", timeout: "5 minutes" }],
  ]);
});

test("workflow entrypoints create native subclasses with generated run methods", async () => {
  const layer = imageWorkflow.toLayer(async (workflow, step) => {
    return step.do(fetchImage, { imageId: workflow.payload.imageId });
  });
  class FakeWorkflowEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  }
  const entrypoints = makeWorkflowEntrypoints(
    { ResizeImage: layer },
    { WorkflowEntrypoint: FakeWorkflowEntrypoint as WorkflowEntrypointConstructor },
  );
  const instance = new entrypoints.ResizeImage({}, { ok: true }) as {
    run(event: unknown, step: NativeWorkflowStep): Promise<unknown>;
  };

  expect(entrypoints.ResizeImage.prototype).toBeInstanceOf(FakeWorkflowEntrypoint);
  await expect(
    instance.run({ payload: { imageId: "img_123" } }, fakeNativeStep()),
  ).resolves.toEqual({ id: "img_123" });
});

test("workflow entrypoints reject invalid class names and non-layers", () => {
  class FakeWorkflowEntrypoint {}

  expect(() =>
    makeWorkflowEntrypoints(
      { "resize-image": imageWorkflow.toLayer(async () => undefined) },
      { WorkflowEntrypoint: FakeWorkflowEntrypoint as WorkflowEntrypointConstructor },
    ),
  ).toThrow(/valid identifier/);
  expect(() =>
    makeWorkflowEntrypoints(
      { ResizeImage: {} as never },
      { WorkflowEntrypoint: FakeWorkflowEntrypoint as WorkflowEntrypointConstructor },
    ),
  ).toThrow(/WorkflowLayer/);
});

test("withCloudflareWorkflows wraps the Cloudflare plugin factory", () => {
  const plugins = withCloudflareWorkflows((config) => ({ name: "cloudflare", config }), {
    worker: "./src/index.ts",
  });

  expect(plugins).toHaveLength(2);
  expect(plugins[0]).toMatchObject({ name: "sideffect:cloudflare-workflows" });
  expect(plugins[1]).toMatchObject({ name: "cloudflare" });
});

test("Sideffect workflows plugin captures native config and points Cloudflare at virtual entry", () => {
  const plugin = createSideffectWorkflowsPlugin({
    config: (workerConfig) => ({ ...workerConfig, name: "app" }),
  });

  expect(plugin.name).toBe("sideffect:cloudflare-workflows");
  expect(typeof plugin.cloudflare.config).toBe("function");

  const workerConfig = {
    main: "./src/index.ts",
    workflows: [{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }],
  };
  const result =
    typeof plugin.cloudflare.config === "function"
      ? (plugin.cloudflare.config(workerConfig), workerConfig)
      : plugin.cloudflare.config;

  expect(result).toMatchObject({
    name: "app",
    main: "virtual:sideffect/entry",
    workflows: [{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }],
  });
  expect(result).not.toHaveProperty("sideffect");
});

test("Sideffect workflows plugin preserves existing Cloudflare bindings", () => {
  const plugin = createSideffectWorkflowsPlugin();
  if (typeof plugin.cloudflare.config !== "function") {
    throw new Error("Expected cloudflare config customizer");
  }

  const workerConfig = {
    main: "./src/index.ts",
    r2_buckets: [{ binding: "BUCKET", bucket_name: "assets" }],
    durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter" }] },
    workflows: [{ binding: "MY_WORKFLOW", name: "my-workflow", class_name: "MyWorkflow" }],
  };
  plugin.cloudflare.config(workerConfig);

  expect(workerConfig).toMatchObject({
    main: "virtual:sideffect/entry",
    r2_buckets: [{ binding: "BUCKET", bucket_name: "assets" }],
    durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter" }] },
    workflows: [{ binding: "MY_WORKFLOW", name: "my-workflow", class_name: "MyWorkflow" }],
  });
});

test("Sideffect workflows plugin discovers workflow bindings from workflow files", () =>
  withTempProject(
    {
      "wrangler.jsonc": `{ "main": "src/index.ts" }`,
      "src/index.ts": `export default { async fetch() { return new Response("ok"); } };`,
      "src/workflows/my-workflow.ts": `
        import { Schema, Workflow } from "sideffect";
        const workflow = Workflow.make({ name: "my-workflow", payload: Schema.String });
        export const myWorkflowLayer = workflow.toLayer(async () => undefined);
      `,
    },
    (root) => {
      const plugin = createSideffectWorkflowsPlugin({ configPath: join(root, "wrangler.jsonc") });
      if (typeof plugin.cloudflare.config !== "function") {
        throw new Error("Expected cloudflare config customizer");
      }

      const workerConfig = { main: "src/index.ts" };
      plugin.cloudflare.config(workerConfig);

      expect(workerConfig).toMatchObject({
        main: "virtual:sideffect/entry",
        workflows: [{ binding: "MY_WORKFLOW", name: "my-workflow", class_name: "MyWorkflow" }],
      });
      expect(
        collectWorkflowEntries("src/workflows", root).map((workflow) => workflow.config),
      ).toEqual([{ binding: "MY_WORKFLOW", name: "my-workflow", class_name: "MyWorkflow" }]);
    },
  ));

test("workflow collector discovers direct Workflow.make(...).toLayer exports", () =>
  withTempProject(
    {
      "src/workflows/my-workflow.ts": `
        import { Schema, Workflow } from "sideffect";
        export const myWorkflowLayer = Workflow.make({
          name: "my-workflow",
          payload: Schema.String,
        }).toLayer(async () => undefined);
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows", root).map((workflow) => workflow.config),
      ).toEqual([{ binding: "MY_WORKFLOW", name: "my-workflow", class_name: "MyWorkflow" }]);
    },
  ));

test("Sideffect workflows plugin skips external workflow script entries", async () => {
  const plugin = createSideffectWorkflowsPlugin();
  if (typeof plugin.cloudflare.config !== "function") {
    throw new Error("Expected cloudflare config customizer");
  }

  plugin.cloudflare.config({
    main: "./src/index.ts",
    name: "worker-a",
    workflows: [
      { binding: "Local", name: "local", class_name: "LocalWorkflow" },
      {
        binding: "External",
        name: "external",
        class_name: "ExternalWorkflow",
        script_name: "worker-b",
      },
    ],
  });

  callConfigResolved(plugin, { root: "/app" });
  const code = await callLoad(plugin, {
    async resolve() {
      return { id: "/app/src/index.ts" };
    },
  });

  expect(String(code)).toContain("LocalWorkflow");
  expect(String(code)).not.toContain("ExternalWorkflow");
});

test("Sideffect workflows plugin resolves and loads virtual entry", async () => {
  const plugin = createSideffectWorkflowsPlugin();
  if (typeof plugin.cloudflare.config !== "function") {
    throw new Error("Expected cloudflare config customizer");
  }

  plugin.cloudflare.config({
    main: "src/index.ts",
    workflows: [{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }],
  });
  callConfigResolved(plugin, { root: "/app" });

  expect(await callResolveId(plugin, "virtual:sideffect/entry")).toBe("\0virtual:sideffect/entry");

  const code = await callLoad(plugin, {
    async resolve(source: string, importer: string) {
      expect(source).toBe("./src/index.ts");
      expect(importer).toBe("/app/__sideffect_virtual_entry__.ts");
      return { id: "/app/src/index.ts" };
    },
  });

  expect(String(code)).toContain('import { WorkflowEntrypoints } from "sideffect/cloudflare"');
  expect(String(code)).toContain('import * as __sideffect_worker from "/app/src/index.ts"');
  expect(String(code)).toContain('export * from "/app/src/index.ts"');
  expect(String(code)).toContain("export default __sideffect_worker.default ?? {}");
  expect(String(code)).toContain("ResizeImage: __sideffectWorkflowLayer");
  expect(String(code)).toContain("export const ResizeImage = __sideffect_entrypoints.ResizeImage");
});

test("Sideffect workflows plugin resolves worker main relative to configPath", async () => {
  const plugin = createSideffectWorkflowsPlugin({ configPath: "cloudflare/wrangler.jsonc" });
  if (typeof plugin.cloudflare.config !== "function") {
    throw new Error("Expected cloudflare config customizer");
  }

  plugin.cloudflare.config({
    main: "./worker.ts",
    workflows: [{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }],
  });
  callConfigResolved(plugin, { root: "/app" });

  await callLoad(plugin, {
    async resolve(_source: string, importer: string) {
      expect(importer).toBe("/app/cloudflare/__sideffect_virtual_entry__.ts");
      return { id: "/app/cloudflare/worker.ts" };
    },
  });
});

test("Sideffect workflows plugin reports invalid virtual entry configuration", async () => {
  const duplicate = createSideffectWorkflowsPlugin();
  if (typeof duplicate.cloudflare.config !== "function") {
    throw new Error("Expected cloudflare config customizer");
  }

  expect(() =>
    (duplicate.cloudflare.config as NonNullable<typeof duplicate.cloudflare.config> & Function)({
      main: "./src/index.ts",
      workflows: [
        { binding: "A", name: "a", class_name: "Duplicate" },
        { binding: "B", name: "b", class_name: "Duplicate" },
      ],
    }),
  ).toThrow(/Duplicate/);

  const unresolved = createSideffectWorkflowsPlugin();
  if (typeof unresolved.cloudflare.config !== "function") {
    throw new Error("Expected cloudflare config customizer");
  }
  unresolved.cloudflare.config({
    main: "./missing.ts",
    workflows: [{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }],
  });
  callConfigResolved(unresolved, { root: "/app" });

  await expect(
    callLoad(unresolved, {
      async resolve() {
        return null;
      },
    }),
  ).rejects.toThrow(/could not resolve/);
});

test("workflowConfigEntries derives native Cloudflare workflow config", () => {
  expect(
    workflowConfigEntries({
      ResizeImage: {
        module: "./src/resize-image.ts",
        export: "resizeImageWorkflowLayer",
      },
    }),
  ).toEqual([{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }]);
});
