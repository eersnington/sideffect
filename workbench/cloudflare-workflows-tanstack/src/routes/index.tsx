import { createFileRoute } from "@tanstack/react-router";
import { workflowCases } from "../workflow-cases";

export const Route = createFileRoute("/")({
  loader: () => workflowCases,
  component: Home,
});

function Home() {
  const cases = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <main className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
            Sideffect Workbench
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            TanStack Start uses the shared Cloudflare Workflow matrix
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            These cases are the same workflow definitions used by the plain Vite workbench. The
            TanStack app adds API routes on top of the generated Cloudflare workflow bindings.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((entry) => (
            <article
              className="rounded-2xl border border-white/10 bg-white/4 p-5 shadow-2xl shadow-cyan-950/20"
              key={entry.key}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{entry.key}</h2>
                  <p className="mt-1 text-sm text-slate-400">{entry.className}</p>
                </div>
                <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                  {entry.binding}
                </span>
              </div>
              <p className="mt-4 rounded-lg bg-black/30 p-3 font-mono text-xs text-slate-300">
                POST /api/e2e/workflows/{entry.key}
              </p>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
