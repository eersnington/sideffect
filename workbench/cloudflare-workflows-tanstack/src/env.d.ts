import type { Counter } from "./worker";

declare global {
  interface Env extends Cloudflare.Env {}

  namespace Cloudflare {
    interface Env {
      COUNTER: DurableObjectNamespace<Counter>;
      NATIVE_CHECK: Workflow<{ label: string }>;
    }
  }
}

export {};
