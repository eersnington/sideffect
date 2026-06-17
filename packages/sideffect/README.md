# Sideffect

Define reusable and readable Cloudflare Workflows in effect inspired code and let the Vite plugin create Wrangler workflow bindings and env types upon `wrangler dev` and `wrangler deploy` step.

You use workflow bindings in your Worker as usual, and not deal with the hassle of configuring wrangler.toml/json file.

> ⚠️ Warning: The API is experimental and is subject to change.

## Why Sideffect

- **Reusable typed steps** — Define workflow steps as schema-backed, reusable activities.
- **No manual Wrangler config** — The Vite plugin discovers your workflow files and generates Wrangler bindings and env types automatically.
- **Use bindings as normal** — Workflow bindings are available on `env` like any other Cloudflare Worker binding.
- **Cloudflare-native runtime** — Sideffect generates native `WorkflowEntrypoint` classes; nothing is emulated.

## Writing Workflows

Define your workflows in `src/workflows`. Each file exports a workflow layer: a typed description of the workflow's payload, its steps, and the logic that connects them.

```ts
// src/workflows/my-workflow.ts
import { Schema, Step, Workflow } from "sideffect";

const workflow = Workflow.make({
  name: "image-processing",
  payload: Schema.Struct({
    imageKey: Schema.String,
  }),
});

const fetchImageStep = Step.make("fetch image", {
  payload: Schema.Struct({ imageKey: Schema.String }),
  result: Schema.Struct({ data: Schema.Uint8Array }),
  run: async (payload, ctx) => {
    const object = await ctx.env.BUCKET.get(payload.imageKey);
    const data = new Uint8Array(await object.arrayBuffer());
    return { data };
  },
});

const generateDescriptionStep = Step.make("generate description", {
  payload: Schema.Struct({ imageData: Schema.Uint8Array }),
  result: Schema.Struct({ description: Schema.String }),
  run: async ({ imageData }, ctx) => {
    const imageArray = Array.from(imageData);
    const result = await ctx.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
      image: imageArray,
      prompt: "Describe this image in one sentence",
      max_tokens: 50,
    });
    return { description: result.description };
  },
});

const publishImageStep = Step.make("publish", {
  payload: Schema.Struct({ imageKey: Schema.String, imageData: Schema.Uint8Array }),
  result: Schema.Void,
  run: async ({ imageKey, imageData }, ctx) => {
    await ctx.env.BUCKET.put(`public/${imageKey}`, imageData);
  },
});

export const myWorkflowLayer = workflow.toLayer(async (event, step) => {
  const image = await step.do(fetchImageStep, { imageKey: event.payload.imageKey });
  const description = await step.do(generateDescriptionStep, { imageData: image.data });

  await step.sleep("wait briefly", "1 second");

  await step.waitForEvent("await approval", { type: "approved", timeout: "24 hours" });

  await step.do(publishImageStep, { imageKey: event.payload.imageKey, imageData: image.data });

  return description;
});
```

The workflow `name` controls how Sideffect and Cloudflare refer to the workflow. For `image-processing`, the Cloudflare class name is `ImageProcessing` and the Worker binding is `IMAGE_PROCESSING`.

## Step Context

`Step.run` receives the same Cloudflare `WorkflowStepContext` fields that native `step.do` callbacks receive:

`ctx.env` is typed from your project's `Cloudflare.Env`; use `wrangler types` or augment it in `src/env.d.ts`.

```ts
const describeImageStep = Step.make("describe image", {
  payload: Schema.Struct({ imageData: Schema.Uint8Array }),
  result: Schema.Struct({ description: Schema.String }),
  run: async ({ imageData }, ctx) => {
    if (ctx.attempt > 1) {
      console.warn(`Retrying ${ctx.step.name}, attempt ${ctx.attempt}`);
    }

    const result = await ctx.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
      image: Array.from(imageData),
      prompt: "Describe this image in one sentence",
      max_tokens: 50,
    });

    return { description: result.description };
  },
});
```

## Rollback

Rollback is a Cloudflare-native feature. Sideffect lets you attach rollback handlers and config per step, but Cloudflare owns execution and ordering.

```ts
const publishImageStep = Step.make("publish image", {
  payload: Schema.Struct({ imageKey: Schema.String, imageData: Schema.Uint8Array }),
  result: Schema.Void,
  run: async ({ imageKey, imageData }, ctx) => {
    await ctx.env.BUCKET.put(`public/${imageKey}`, imageData);
  },
}).pipe(
  Rollback.with((_result, ctx) => {
    return ctx.env.BUCKET.delete(`public/${ctx.payload.imageKey}`);
  }),
);
```

## Vite Adapter

The recommended setup uses Cloudflare's Vite plugin alongside Sideffect's adapter. Wrap `cloudflare` with `withCloudflareWorkflows` and the rest is automatic — Sideffect discovers your workflow layers and injects the generated entrypoints and Wrangler bindings into the build output.

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { withCloudflareWorkflows } from "sideffect/vite";

export default defineConfig({
  plugins: [
    withCloudflareWorkflows(cloudflare, {
      workflowPaths: ["src/jobs", "src/features/billing/workflows"],
    }),
  ],
});
```

By default Sideffect scans `src/workflows`. If your workflow files live elsewhere, pass `workflowPaths`.

Your source `wrangler.jsonc` does not need a `workflows` field. Sideffect writes the workflow config into the Vite build output and generates env types for the workflow bindings it creates.

Use the generated binding from your Worker as usual:

```ts
export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const instance = await env.IMAGE_PROCESSING.create({
      params: { imageKey: "uploaded-photo-123" },
    });

    return Response.json({ id: instance.id });
  },
};
```

## Plain Wrangler

Without the Vite adapter, Wrangler needs two things you provide manually: the native workflow class exported from your Worker entry, and the matching binding in `wrangler.jsonc`. Sideffect creates the class from your workflow layer via `WorkflowEntrypoints.make`.

Export the native workflow class alongside your Worker:

```ts
// src/index.ts
import { WorkflowEntrypoints } from "sideffect/cloudflare";
import { myWorkflowLayer } from "./workflows/my-workflow";

type Params = {
  imageKey: string;
};

declare global {
  namespace Cloudflare {
    interface Env {
      BUCKET: R2Bucket;
      AI: Ai;
      IMAGE_PROCESSING: Workflow<Params>;
    }
  }

  interface Env extends Cloudflare.Env {}
}

export const { ImageProcessing } = WorkflowEntrypoints.make({
  ImageProcessing: myWorkflowLayer,
});

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const instance = await env.IMAGE_PROCESSING.create({
      params: {
        imageKey: "uploaded-photo-123",
      },
    });

    return Response.json({ id: instance.id });
  },
};
```

Then register the workflow in your Wrangler config. The `class_name` must match the key passed to `WorkflowEntrypoints.make`, and `binding` is the property available on `env`:

```jsonc
{
  "main": "src/index.ts",
  "workflows": [
    {
      "binding": "IMAGE_PROCESSING",
      "name": "image-processing",
      "class_name": "ImageProcessing",
    },
  ],
}
```

## LICENSE

Apache-2.0
