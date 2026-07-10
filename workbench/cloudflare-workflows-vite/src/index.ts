import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";
import {
  createSharedWorkflow,
  getSharedWorkflow,
  sharedWorkflowCases,
} from "cloudflare-workflows-shared";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { WorkflowCase } from "cloudflare-workflows-shared";

const nativeWorkflowCase = {
  key: "native-check",
  binding: "NATIVE_CHECK",
  className: "NativeCheck",
  params: { label: "native" },
} as const satisfies WorkflowCase;

const e2eCases = [
  ...sharedWorkflowCases,
  nativeWorkflowCase,
] as const satisfies ReadonlyArray<WorkflowCase>;

export class NativeCheck extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<{ label: string }>, step: WorkflowStep) {
    return step.do("native check", async () => ({
      label: event.payload.label,
      mode: "native",
    }));
  }
}

export class Counter extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const count = ((await this.ctx.storage.get<number>("count")) ?? 0) + 1;
    await this.ctx.storage.put("count", count);

    return Response.json({ count });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/favicon")) {
      return Response.json({}, { status: 404 });
    }

    if (url.pathname === "/counter") {
      const id = env.COUNTER.idFromName("demo");
      const stub = env.COUNTER.get(id);
      return stub.fetch(req);
    }

    if (url.pathname === "/api/workflows") {
      return Response.json(e2eCases);
    }

    const workflowMatch = /^\/api\/workflows\/([^/]+)$/.exec(url.pathname);
    if (workflowMatch) {
      const [, key] = workflowMatch;
      const e2eCase = e2eCases.find((entry) => entry.key === key);
      if (!e2eCase) {
        return Response.json({ error: `Unknown workflow case ${key}` }, { status: 404 });
      }

      if (req.method === "POST") {
        const id = url.searchParams.get("id") ?? `${e2eCase.key}-${Date.now()}`;
        const instance =
          e2eCase.binding === "NATIVE_CHECK"
            ? await env.NATIVE_CHECK.create({ id, params: e2eCase.params })
            : await createSharedWorkflow(env, e2eCase, id);
        return Response.json({ id: instance.id, status: await instance.status() });
      }

      if (req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) {
          return Response.json({ error: "Missing workflow instance id" }, { status: 400 });
        }

        const instance =
          e2eCase.binding === "NATIVE_CHECK"
            ? await env.NATIVE_CHECK.get(id)
            : await getSharedWorkflow(env, e2eCase, id);
        return Response.json(await instance.status());
      }

      return Response.json({ error: `Unsupported method ${req.method}` }, { status: 405 });
    }

    const id = url.searchParams.get("instanceId");
    if (id) {
      const instance = await env.ADD_NUMBERS.get(id);
      return Response.json({
        status: await instance.status(),
      });
    }

    const instance = await env.ADD_NUMBERS.create({
      params: {
        left: 2,
        right: 3,
      },
    });

    return Response.json({
      id: instance.id,
      details: await instance.status(),
    });
  },
};
