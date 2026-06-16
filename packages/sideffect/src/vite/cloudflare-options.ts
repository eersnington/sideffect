import type { WorkflowConfigEntry } from "../types.ts";

/** Worker configuration shape passed through Cloudflare's Vite plugin `config` hook. */
export interface WorkerConfig {
  /** Worker entry module from Wrangler or a Cloudflare config customizer. */
  readonly main?: string;
  /** Worker name used when deriving generated workflow entrypoint imports. */
  readonly name?: string;
  /** Cloudflare Workflow bindings configured for the Worker. */
  readonly workflows?: Array<WorkflowConfigEntry>;
  readonly [key: string]: unknown;
}

/**
 * Cloudflare Worker config customizer accepted by Sideffect's wrapper.
 *
 * The callback form may mutate `config` in place or return a partial config to
 * merge, matching Cloudflare's Vite plugin behavior for the entry Worker.
 */
export type WorkerConfigCustomizer =
  | Partial<WorkerConfig>
  | ((config: WorkerConfig, ...args: Array<any>) => Partial<WorkerConfig> | void);

/** @internal Local mirror of Cloudflare's lazy dev-only option. */
type CloudflareDevOnly = boolean | (() => boolean);

/** @internal Local mirror of Cloudflare's `persistState` option. */
type CloudflarePersistState = boolean | { readonly path: string };

/** @internal Local mirror of Cloudflare's Vite environment config option. */
interface CloudflareViteEnvironmentConfig {
  /** Vite environment name for this Worker. */
  readonly name?: string;
  /** Child Vite environments that should be associated with this Worker. */
  readonly childEnvironments?: Array<string>;
}

/** @internal Local mirror of Cloudflare's tunnel config option. */
interface CloudflareTunnelConfig {
  /** Start the tunnel automatically during dev or preview. */
  readonly autoStart?: boolean;
  /** Named Cloudflare Tunnel to use instead of a quick tunnel. */
  readonly name?: string;
}

/**
 * @internal Local mirror of Cloudflare file-based auxiliary Worker options.
 *
 * Keep this structural so `sideffect/vite` declarations do not import
 * `@cloudflare/vite-plugin` or its Wrangler/Miniflare transitive types.
 */
interface CloudflareAuxiliaryWorkerFileConfig {
  /** Path to the auxiliary Worker's Wrangler config file. */
  readonly configPath: string;
  /** Optional config customizer applied after loading the config file. */
  readonly config?: WorkerConfigCustomizer;
  /** Whether this auxiliary Worker should be omitted from production builds. */
  readonly devOnly?: CloudflareDevOnly;
  /** Vite environment settings for this auxiliary Worker. */
  readonly viteEnvironment?: CloudflareViteEnvironmentConfig;
}

/** @internal Local mirror of Cloudflare inline auxiliary Worker options. */
interface CloudflareAuxiliaryWorkerInlineConfig {
  /** Optional path to the auxiliary Worker's Wrangler config file. */
  readonly configPath?: string;
  /** Inline config customizer for the auxiliary Worker. */
  readonly config: WorkerConfigCustomizer;
  /** Whether this auxiliary Worker should be omitted from production builds. */
  readonly devOnly?: CloudflareDevOnly;
  /** Vite environment settings for this auxiliary Worker. */
  readonly viteEnvironment?: CloudflareViteEnvironmentConfig;
}

/** @internal Local mirror of Cloudflare auxiliary Worker options. */
type CloudflareAuxiliaryWorkerConfig =
  | CloudflareAuxiliaryWorkerFileConfig
  | CloudflareAuxiliaryWorkerInlineConfig;

/**
 * @internal Local mirror of Cloudflare file-based prerender Worker options.
 *
 * This exists only for the forwarded `experimental.prerenderWorker` option.
 */
interface CloudflarePrerenderWorkerFileConfig {
  /** Path to the prerender Worker's Wrangler config file. */
  readonly configPath: string;
  /** Optional config customizer applied after loading the config file. */
  readonly config?: WorkerConfigCustomizer;
  /** Vite environment settings for the prerender Worker. */
  readonly viteEnvironment?: CloudflareViteEnvironmentConfig;
}

/** @internal Local mirror of Cloudflare inline prerender Worker options. */
interface CloudflarePrerenderWorkerInlineConfig {
  /** Optional path to the prerender Worker's Wrangler config file. */
  readonly configPath?: string;
  /** Inline config customizer for the prerender Worker. */
  readonly config: WorkerConfigCustomizer;
  /** Vite environment settings for the prerender Worker. */
  readonly viteEnvironment?: CloudflareViteEnvironmentConfig;
}

/** @internal Local mirror of Cloudflare prerender Worker options. */
type CloudflarePrerenderWorkerConfig =
  | CloudflarePrerenderWorkerFileConfig
  | CloudflarePrerenderWorkerInlineConfig;

/** @internal Local mirror of Cloudflare generated type options for `newConfig`. */
interface CloudflareNewConfigTypesOptions {
  /** Whether Cloudflare should generate Worker configuration types. */
  readonly generate?: boolean;
}

/** @internal Local mirror of Cloudflare's `experimental.newConfig` object form. */
interface CloudflareNewConfigOptions {
  /** Options for Cloudflare's generated Worker configuration types. */
  readonly types?: CloudflareNewConfigTypesOptions;
}

/**
 * @internal Local mirror of Cloudflare experimental plugin options.
 *
 * Keep this structural so `sideffect/vite` declarations do not import
 * `@cloudflare/vite-plugin` or its Wrangler/Miniflare transitive types.
 */
interface CloudflareExperimentalConfig {
  /** Enables Cloudflare's development-mode support for `_headers` and `_redirects`. */
  readonly headersAndRedirectsDevModeSupport?: boolean;
  /** Configures Cloudflare's dedicated prerender Worker support. */
  readonly prerenderWorker?: CloudflarePrerenderWorkerConfig;
  /** Enables Cloudflare's experimental `cloudflare.config.ts` support. */
  readonly newConfig?: boolean | CloudflareNewConfigOptions;
}

/**
 * Cloudflare Vite plugin options accepted by Sideffect and forwarded to
 * `@cloudflare/vite-plugin`.
 *
 * Sideffect mirrors the relevant option shape locally instead of importing
 * `PluginConfig` from `@cloudflare/vite-plugin`. Cloudflare's published
 * declaration currently imports Wrangler, Miniflare, Vite, and Cloudflare
 * utility declarations, which would leak optional peer transitive types through
 * `sideffect/vite`.
 */
export interface CloudflarePluginConfig {
  /** Entry Worker config customizer passed to Cloudflare's Vite plugin. */
  readonly config?: WorkerConfigCustomizer;
  /** Path to the entry Worker's Wrangler config file. */
  readonly configPath?: string;
  /** Whether the entry Worker should be omitted from production builds. */
  readonly assetsOnly?: CloudflareDevOnly;
  /** Additional Workers to run or build alongside the entry Worker. */
  readonly auxiliaryWorkers?: Array<CloudflareAuxiliaryWorkerConfig>;
  /** Vite environment settings for the entry Worker. */
  readonly viteEnvironment?: CloudflareViteEnvironmentConfig;
  /** Miniflare persistence mode forwarded to Cloudflare's plugin. */
  readonly persistState?: CloudflarePersistState;
  /** Inspector port for Worker debugging, or `false` to disable inspection. */
  readonly inspectorPort?: number | false;
  /** Whether Cloudflare should use remote bindings during local development. */
  readonly remoteBindings?: boolean;
  /** Cloudflare Tunnel sharing options for dev or preview servers. */
  readonly tunnel?: boolean | CloudflareTunnelConfig;
  /** Experimental Cloudflare Vite plugin options forwarded unchanged. */
  readonly experimental?: CloudflareExperimentalConfig;
}
