import { Rollback, Schema, Step, Workflow } from "../src/index.ts";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly BUCKET: R2Bucket;
      readonly COUNTER: DurableObjectNamespace;
      readonly DB: D1Database;
    }
  }
}

const envBackedStep = Step.make("env backed step", {
  payload: Schema.String,
  result: Schema.String,
  run: async (key, ctx) => {
    const bucket: R2Bucket = ctx.env.BUCKET;
    const counter: DurableObjectNamespace = ctx.env.COUNTER;
    const db: D1Database = ctx.env.DB;

    await bucket.get(key);
    counter.idFromName(key);
    await db.prepare("SELECT 1").all();

    return key;
  },
}).pipe(
  Rollback.with(async (_result, ctx) => {
    const bucket: R2Bucket = ctx.env.BUCKET;
    await bucket.delete(ctx.payload);
  }),
);

Workflow.make({
  name: "env-backed-workflow",
  payload: Schema.String,
}).toLayer(async (workflow, step) => {
  const bucket: R2Bucket = workflow.env.BUCKET;
  await bucket.head(workflow.payload);

  return step.do(envBackedStep, workflow.payload);
});

export {};
