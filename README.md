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

Wrangler stays the workflow registry. Sideffect only creates the native
`WorkflowEntrypoint` class exports that Cloudflare expects.

```ts
import { WorkflowEntrypoints } from "sideffect/cloudflare";
import { resizeImageWorkflowLayer } from "./workflows/resize-image";

export const { ResizeImage } = WorkflowEntrypoints.make({
  ResizeImage: resizeImageWorkflowLayer,
});

export default {
  async fetch() {
    return new Response("ok");
  },
};
```

```toml
main = "./src/index.ts"

[[workflows]]
binding = "RESIZE_IMAGE"
name = "resize-image"
class_name = "ResizeImage"
```

## Vite Adapter

If a project already uses Cloudflare's Vite plugin, Sideffect can generate the
entrypoint exports from layer exports named after `class_name`.

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { withCloudflareWorkflows } from "sideffect/vite";

export default defineConfig({
  plugins: [withCloudflareWorkflows(cloudflare)],
});
```

## Development

```sh
bun run check
bun run test
```
