import server from "@tanstack/react-start/server-entry";
import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { workflowCases } from "./workflow-cases";

export class Counter extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const count = ((await this.ctx.storage.get<number>("count")) ?? 0) + 1;
    await this.ctx.storage.put("count", count);

    return Response.json({ count });
  }
}

export class NativeCheck extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<{ label: string }>, step: WorkflowStep) {
    return step.do("native check", async () => ({
      label: event.payload.label,
      mode: "native",
    }));
  }
}

export * from "@tanstack/react-start/server-entry";

const tanstack = server as { readonly fetch: NonNullable<ExportedHandler<Env>["fetch"]> };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/e2e/workflows") {
      return Response.json(workflowCases);
    }

    const workflowMatch = /^\/api\/e2e\/workflows\/([^/]+)$/.exec(url.pathname);
    if (workflowMatch) {
      const [, key] = workflowMatch;
      const e2eCase = workflowCases.find((entry) => entry.key === key);
      if (!e2eCase) {
        return Response.json({ error: `Unknown workflow case ${key}` }, { status: 404 });
      }

      const workflow = (env as unknown as Record<string, Workflow<unknown>>)[e2eCase.binding];
      if (request.method === "POST") {
        const id = url.searchParams.get("id") ?? `${e2eCase.key}-${Date.now()}`;
        const instance = await workflow.create({ id, params: e2eCase.params });

        return Response.json({ id: instance.id, status: await instance.status() });
      }

      if (request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) {
          return Response.json({ error: "Missing workflow instance id" }, { status: 400 });
        }

        const instance = await workflow.get(id);
        return Response.json(await instance.status());
      }

      return Response.json({ error: `Unsupported method ${request.method}` }, { status: 405 });
    }

    return tanstack.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
