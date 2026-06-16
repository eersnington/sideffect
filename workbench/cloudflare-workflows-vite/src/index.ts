import { DurableObject } from "cloudflare:workers";

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

    const id = url.searchParams.get("instanceId");
    if (id) {
      const instance = await env.MY_WORKFLOW.get(id);
      return Response.json({
        status: await instance.status(),
      });
    }

    const instance = await env.MY_WORKFLOW.create({
      params: {
        email: "demo@example.com",
        metadata: { source: "vite" },
      },
    });

    return Response.json({
      id: instance.id,
      details: await instance.status(),
    });
  },
};
