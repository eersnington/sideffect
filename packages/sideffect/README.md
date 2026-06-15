# Sideffect

Effect inspired typed workflow and step helpers for Cloudflare Workflows.

> ⚠️ Warning: The API experimental and is subject to change.

## Scope

- No custom runtime or wrapped `fetch` handler.
- Typed workflows and steps.
- Generated workflow wiring.
- 1:1 Cloudflare Workflows API coverage.
- Effect V4 is optional.

## Writing Workflows

Define your workflows in `src/workflows`. Each file exports a workflow layer; a typed description of the workflow's payload, its steps, and the logic that connects them.

```ts
// src/workflows/my-workflow.ts
import { Schema, Step, Workflow } from "sideffect";

const workflow = Workflow.make({
  name: "my-workflow",
  payload: Schema.Struct({
    email: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.String),
  }),
});

const collectFiles = Step.make("collect files", {
  payload: Schema.Struct({ email: Schema.String }),
  result: Schema.Struct({ files: Schema.Array(Schema.String) }),
  run: ({ email }) => ({
    files: [`welcome-${email}.pdf`, "report.pdf"],
  }),
});

export const myWorkflowLayer = workflow.toLayer(async (event, step) => {
  const files = await step.do(collectFiles, { email: event.payload.email });
  await step.sleep("wait briefly", "1 second");
  return files;
});
```

The workflow `name` controls how Sideffect and Cloudflare refer to the workflow. For `my-workflow`, the Cloudflare class name is `MyWorkflow` and the Worker binding is `MY_WORKFLOW`.

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

Your source `wrangler.jsonc` does not need a `workflows` field. Sideffect writes the workflow bindings into the Vite build output, which Cloudflare's plugin uses for deployment.

Use the generated binding from your Worker as usual:

```ts
type Params = {
  email: string;
  metadata: Record<string, string>;
};

interface Env {
  MY_WORKFLOW: Workflow<Params>;
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const instance = await env.MY_WORKFLOW.create({
      params: {
        email: "demo@example.com",
        metadata: { source: "vite" },
      },
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
  email: string;
  metadata: Record<string, string>;
};

interface Env {
  MY_WORKFLOW: Workflow<Params>;
}

export const { MyWorkflow } = WorkflowEntrypoints.make({
  MyWorkflow: myWorkflowLayer,
});

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const instance = await env.MY_WORKFLOW.create({
      params: {
        email: "demo@example.com",
        metadata: { source: "wrangler" },
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
      "binding": "MY_WORKFLOW",
      "name": "my-workflow",
      "class_name": "MyWorkflow",
    },
  ],
}
```

## Development

```sh
bun run check
bun run test
```
