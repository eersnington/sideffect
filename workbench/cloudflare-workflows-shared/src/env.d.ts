declare global {
  interface Env extends Cloudflare.Env {}

  namespace Cloudflare {
    interface Env {
      readonly COUNTER: DurableObjectNamespace;
    }
  }
}

export {};
