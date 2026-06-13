import { Effect } from "effect";
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
import { workflowConfigEntries, withCloudflareWorkflows } from "../src/vite.ts";
import type { NativeWorkflowStep } from "../src/types.ts";

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

test("withCloudflareWorkflows composes Cloudflare config customizers", () => {
  const config = withCloudflareWorkflows({
    worker: "./src/index.ts",
    config: (workerConfig) => ({ ...workerConfig, name: "app" }),
    workflows: {
      ResizeImage: {
        module: "./src/resize-image.ts",
        export: "resizeImageWorkflowLayer",
      },
    },
  });

  expect(typeof config.config).toBe("function");

  const result =
    typeof config.config === "function"
      ? config.config({} as Parameters<typeof config.config>[0])
      : config.config;

  expect(result).toMatchObject({
    name: "app",
    main: "virtual:sideffect/entry",
    workflows: [{ binding: "ResizeImage", name: "resize-image", class_name: "ResizeImage" }],
  });
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
