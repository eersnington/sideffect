# Sideffect

Effect style typed workflow and step helpers for Cloudflare Workflows.

API unstable.

## Scope

- No custom runtime.
- No wrapped `fetch` handler.
- Typed workflows and steps.
- Generated workflow wiring.
- 1:1 Cloudflare Workflows API Coverage
- Effect V4 is optional.

## Imports

```ts
import { Workflow, Step, Rollback } from "sideffect";
import { WorkflowEntrypoints } from "sideffect/cloudflare";
import { withCloudflareWorkflows } from "sideffect/vite";
```

## Cloudflare Workflows

Define workflows once with `Workflow.make(...).toLayer(...)`. In Vite projects,
Sideffect discovers workflow files and generates the Cloudflare wiring.

```ts
// src/workflows/resize-image.ts
import { Schema, Workflow } from "sideffect";

const resizeImage = Workflow.make({
  name: "resize-image",
  payload: Schema.Struct({ imageId: Schema.String }),
});

export const resizeImageLayer = resizeImage.toLayer(async (workflow) => {
  return { imageId: workflow.payload.imageId };
});
```

Sideffect derives:

```json
{
  "binding": "RESIZE_IMAGE",
  "name": "resize-image",
  "class_name": "ResizeImage"
}
```

No `as ResizeImage` export alias is required.

## Vite Adapter

If a project already uses Cloudflare's Vite plugin, Sideffect generates the
entrypoint exports and workflow bindings during Vite config resolution.

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { withCloudflareWorkflows } from "sideffect/vite";

export default defineConfig({
  plugins: [withCloudflareWorkflows(cloudflare)],
});
```

Your source `wrangler.jsonc` does not need a `workflows` field. The Vite build
output `wrangler.json` includes generated workflow bindings, and Cloudflare's
Vite plugin writes Wrangler's redirected deploy config.

## Plain Wrangler

Plain Wrangler cannot be zero-config today because Wrangler reads workflow
bindings before `build.command` runs. Use Vite for the generated wiring path.

The low-level escape hatch is still available:

```ts
import { WorkflowEntrypoints } from "sideffect/cloudflare";
import { resizeImageLayer } from "./workflows/resize-image";

export const { ResizeImage } = WorkflowEntrypoints.make({
  ResizeImage: resizeImageLayer,
});
```

```jsonc
{
  "workflows": [
    {
      "binding": "RESIZE_IMAGE",
      "name": "resize-image",
      "class_name": "ResizeImage",
    },
  ],
}
```

## Development

```sh
bun run check
bun run test
```
