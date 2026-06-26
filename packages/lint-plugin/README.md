# @sideffect/lint

Lint rules for Cloudflare Workflows and Sideffect workflows.

`@sideffect/lint` catches workflow bugs that are easy to miss in review: unowned step promises, mutation of replayed event payloads, unsafe races between steps, unstable step names, and `step.do` timeouts that exceed Cloudflare's recommended limit.

The same rules run in ESLint and Oxlint, and they work with both native Cloudflare `WorkflowEntrypoint` classes and Sideffect `Workflow.make(...).toLayer(...)` definitions.

> This package is experimental. Rule behavior and public exports may change before `1.0`.

## Install

```sh
bun add -D @sideffect/lint
```

Install the runner you use as well:

```sh
bun add -D eslint
# or
bun add -D oxlint
```

`eslint` and `oxlint` are optional peer dependencies so you only need the one your project runs.

## Quick Start

### ESLint

Use the recommended flat config:

```js
// eslint.config.js
import sideffect from "@sideffect/lint/eslint";

export default [...sideffect.configs.recommended];
```

Use `strict` if you also want step-name determinism and timeout checks:

```js
// eslint.config.js
import sideffect from "@sideffect/lint/eslint";

export default [...sideffect.configs.strict];
```

### Oxlint

Register the JavaScript plugin and enable the rules you want:

```jsonc
// .oxlintrc.json
{
  "jsPlugins": [
    {
      "name": "sideffect",
      "specifier": "@sideffect/lint/oxlint",
    },
  ],
  "rules": {
    "sideffect/await-step-calls": "error",
    "sideffect/no-event-mutation": "error",
    "sideffect/no-step-race-any-outside-step": "warn",
  },
}
```

For Vite+ projects, you can import the bundled Oxlint preset:

```ts
// vite.config.ts
import { oxlintRecommended } from "@sideffect/lint";
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: oxlintRecommended,
});
```

Use `oxlintStrict` to enable every rule:

```ts
// vite.config.ts
import { oxlintStrict } from "@sideffect/lint";
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: oxlintStrict,
});
```

## Presets

`recommended` enables the rules that protect core workflow correctness:

```txt
sideffect/await-step-calls: error
sideffect/no-event-mutation: error
sideffect/no-step-race-any-outside-step: warn
```

`strict` includes `recommended` and adds rules for deploy-time hygiene:

```txt
sideffect/deterministic-step-names: warn
sideffect/max-step-timeout-30m: error
```

## Supported Workflow Shapes

### Native Cloudflare Workflows

Rules run inside `run(event, step)` methods on classes that extend `WorkflowEntrypoint` from `cloudflare:workers`:

```ts
import { WorkflowEntrypoint } from "cloudflare:workers";

export class BillingWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    await step.do("charge customer", async () => {
      return chargeCustomer(event.payload.customerId);
    });
  }
}
```

Namespace imports are supported too:

```ts
import * as cf from "cloudflare:workers";

export class BillingWorkflow extends cf.WorkflowEntrypoint {
  async run(event, step) {
    return step.sleep("pause", "1 second");
  }
}
```

### Sideffect Workflows

Rules also run inside Sideffect workflow layers:

```ts
import { Schema, Step, Workflow } from "sideffect";

const billingWorkflow = Workflow.make({
  name: "billing",
  payload: Schema.Struct({ customerId: Schema.String }),
});

const chargeCustomer = Step.make("charge customer", {
  payload: Schema.Struct({ customerId: Schema.String }),
  result: Schema.Void,
  run: async ({ customerId }, ctx) => {
    await ctx.env.PAYMENTS.charge(customerId);
  },
});

export const billingWorkflowLayer = billingWorkflow.toLayer(async ({ payload }, step) => {
  await step.do(chargeCustomer, payload);
});
```

The plugin recognizes direct `Workflow.make(...).toLayer(...)` calls, local workflow constants, exported workflow constants, and imported local definitions whose names end in `Workflow`.

Effect-style layer bodies are supported when the step promise is owned by `Effect.promise` or `Effect.tryPromise`:

```ts
Workflow.make({ name: "billing" }).toLayer(
  Effect.fn(function* ({ payload }, step) {
    return yield* Effect.promise(() => step.do(chargeCustomer, payload));
  }),
);
```

## Rules

### `sideffect/await-step-calls`

Workflow step calls must be owned. A call to `step.do`, `step.sleep`, `step.sleepUntil`, or `step.waitForEvent` should be awaited, returned, yielded, chained from a returned promise, or collected by an awaited promise aggregate.

```ts
// Bad: the workflow can continue before the step is tracked.
step.do("charge customer", async () => chargeCustomer(event.payload.customerId));

// Good: the workflow owns the step promise.
await step.do("charge customer", async () => chargeCustomer(event.payload.customerId));
```

Owned promise aggregates are accepted:

```ts
const [customer, invoice] = await Promise.all([
  step.do("fetch customer", async () => fetchCustomer(event.payload.customerId)),
  step.do("fetch invoice", async () => fetchInvoice(event.payload.invoiceId)),
]);
```

The rule accepts `Promise.all`, `Promise.allSettled`, `Promise.race`, and `Promise.any` when the aggregate itself is owned. Pair it with `no-step-race-any-outside-step` if you want to block replay-unsafe races.

### `sideffect/no-event-mutation`

Workflow events and payloads are replay inputs. Mutating them can make retries, restarts, and local reasoning disagree about what state actually exists.

```ts
// Bad: mutates replay input.
event.payload.status = "charged";

// Good: derive a new value and persist it through a step.
const nextStatus = await step.do("charge", async () => "charged");
```

The rule catches direct assignments, updates, deletes, and common mutating methods through simple aliases:

```ts
const { payload } = event;

payload.items.push("charged");
delete payload.pendingChargeId;
```

### `sideffect/no-step-race-any-outside-step`

`Promise.race` and `Promise.any` over step promises can replay inconsistently when the race happens in workflow code. Put the race inside a `step.do` callback so the result is captured as one step outcome.

```ts
// Bad: races workflow steps directly.
const winner = await Promise.race([
  step.do("slow provider", async () => callSlowProvider()),
  step.do("fast provider", async () => callFastProvider()),
]);

// Good: captures the race result inside one step.
const winner = await step.do("race providers", async () => {
  return Promise.race([callSlowProvider(), callFastProvider()]);
});
```

### `sideffect/deterministic-step-names`

Step names are stable identifiers for persisted workflow state. Do not build them from time, randomness, or generated IDs.

```ts
// Bad: creates a different step name on replay.
await step.do(`run at ${Date.now()}`, async () => event.payload);

// Good: stable name, variable data stays in the payload.
await step.do("process payload", async () => event.payload);
```

The rule checks names passed to native step calls and names passed to `Step.make(...)`. It detects `Date.now()`, `new Date()`, `Math.random()`, and `crypto.randomUUID()`.

### `sideffect/max-step-timeout-30m`

Cloudflare recommends `step.do` timeouts of 30 minutes or less. Use `step.waitForEvent` or split the workflow when work needs to wait longer.

```ts
// Bad: longer than 30 minutes.
await step.do("call provider", { timeout: "2 hours" }, async () => callProvider());

// Good: within the recommended limit.
await step.do("call provider", { timeout: "30 minutes" }, async () => callProvider());
```

For Sideffect step definitions, the timeout object is the third argument:

```ts
await step.do(chargeCustomer, payload, { timeout: "30 minutes" });
```

The rule handles string durations, static template literals, and numeric millisecond literals.

## Manual Rule Configuration

If you do not want a preset, register the plugin and choose rules directly.

```js
// eslint.config.js
import sideffect from "@sideffect/lint/eslint";

export default [
  {
    plugins: { sideffect },
    rules: {
      "sideffect/await-step-calls": "error",
      "sideffect/no-event-mutation": "error",
      "sideffect/no-step-race-any-outside-step": "warn",
      "sideffect/deterministic-step-names": "warn",
      "sideffect/max-step-timeout-30m": "error",
    },
  },
];
```

## Limitations

`@sideffect/lint` is syntax-only. It does not run TypeScript type resolution, execute modules, or prove that arbitrary functions are deterministic.

That keeps the plugin fast and lets the same rule implementations run in both ESLint and Oxlint, but it also means recognition is intentionally conservative. Imported local workflow definitions are detected with syntax and naming heuristics rather than full runtime value tracking.

## License

Apache-2.0
