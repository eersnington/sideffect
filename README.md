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
import { withCloudflareWorkflows } from "sideffect/vite";
```

## Development

```sh
bun run check
bun run test
```
