import type { Counter } from "./index";

declare global {
  interface Env {
    COUNTER: DurableObjectNamespace<Counter>;
  }
}

export {};
