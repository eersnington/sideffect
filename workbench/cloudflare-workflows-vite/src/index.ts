type Params = {
  email: string;
  metadata: Record<string, string>;
};

interface Env {
  MY_WORKFLOW: Workflow<Params>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/favicon")) {
      return Response.json({}, { status: 404 });
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
