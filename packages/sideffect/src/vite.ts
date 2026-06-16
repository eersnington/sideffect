import { dirname, resolve } from "node:path";

import { defu } from "defu";

import { validateWorkflowExportName } from "./entrypoints.ts";
import {
  generateVirtualEntryModule,
  writeWorkflowEnvTypes,
  type CapturedWorkflow,
} from "./vite/generated-entry.ts";
import { collectWorkflowEntries, type WorkflowDiscoveryPaths } from "./vite/workflow-discovery.ts";
import type { CloudflarePluginConfig, WorkerConfig } from "./vite/cloudflare-options.ts";
import type { WorkflowConfigEntry } from "./types.ts";

export type {
  CloudflarePluginConfig,
  WorkerConfig,
  WorkerConfigCustomizer,
} from "./vite/cloudflare-options.ts";
export { collectWorkflowEntries } from "./vite/workflow-discovery.ts";
export type { WorkflowDiscoveryPaths } from "./vite/workflow-discovery.ts";

const virtualEntry = "virtual:sideffect/entry";
const resolvedVirtualEntry = `\0${virtualEntry}`;

/**
 * Options for `withCloudflareWorkflows()`.
 *
 * Includes Sideffect-specific workflow discovery options plus Cloudflare Vite
 * plugin options that are forwarded to `@cloudflare/vite-plugin`.
 */
export interface WithCloudflareWorkflowsOptions extends CloudflarePluginConfig {
  /** Original Worker entry module when it cannot be read from Cloudflare config. */
  readonly worker?: string;
  /**
   * Workflow files or directories to scan for Sideffect workflow layers.
   *
   * @default ["src/workflows"]
   */
  readonly workflowPaths?: WorkflowDiscoveryPaths;
}

/** Factory function exported by `@cloudflare/vite-plugin`. */
export type CloudflarePluginFactory<Result = unknown> = (config?: any) => Result;

/** Minimal Vite plugin shape used by Sideffect without importing Vite types. */
export interface Plugin {
  readonly name: string;
  readonly enforce?: "pre" | "post";
  readonly sharedDuringBuild?: boolean;
  config?(config: { readonly root?: string }): void;
  configResolved?(config: { readonly root: string }): void;
  resolveId?(source: string): string | void;
  load?(this: ResolveContext, id: string): Promise<string | void> | string | void;
}

/** Sideffect Vite plugin plus the Cloudflare config object it forwards. */
export interface SideffectWorkflowsPlugin extends Plugin {
  /** Config object passed to `@cloudflare/vite-plugin` by `withCloudflareWorkflows()`. */
  readonly cloudflare: CloudflarePluginConfig;
}

/** @internal Cloudflare config captured during Cloudflare's Vite config hook. */
interface CapturedWorkflowConfig {
  /** Original user Worker entry before Sideffect replaces it with the virtual entry. */
  readonly sourceMain?: string;
  /** Workflow bindings to expose from the generated entry module. */
  readonly workflows: Array<CapturedWorkflow>;
}

/** @internal Minimal Vite plugin load context used to resolve the original Worker. */
interface ResolveContext {
  resolve(
    source: string,
    importer?: string,
    options?: { readonly skipSelf?: boolean },
  ): Promise<{ readonly id: string } | null>;
}

/**
 * Wraps Cloudflare's Vite plugin with Sideffect workflow discovery.
 *
 * Sideffect adds a pre-plugin that discovers `Workflow.make(...).toLayer(...)`
 * exports, writes Cloudflare workflow bindings, and points Cloudflare at the
 * generated `virtual:sideffect/entry` module. Cloudflare plugin options are
 * forwarded unchanged.
 *
 * @example
 * ```ts
 * import { cloudflare } from "@cloudflare/vite-plugin";
 * import { defineConfig } from "vite";
 * import { withCloudflareWorkflows } from "sideffect/vite";
 *
 * export default defineConfig({
 *   plugins: [
 *     ...withCloudflareWorkflows(cloudflare, {
 *       persistState: true,
 *       inspectorPort: 9229,
 *     }),
 *   ],
 * });
 * ```
 */
export function withCloudflareWorkflows<Result>(
  cloudflare: CloudflarePluginFactory<Result>,
  options: WithCloudflareWorkflowsOptions = {},
): Array<Plugin | Result> {
  const sideffect = createSideffectWorkflowsPlugin(options);
  return [sideffect, cloudflare(sideffect.cloudflare)];
}

/**
 * Creates the Sideffect workflow discovery plugin without invoking Cloudflare's plugin factory.
 *
 * Use `withCloudflareWorkflows()` for normal Vite config. This lower-level
 * helper is useful for tests and custom plugin composition.
 */
export function createSideffectWorkflowsPlugin(
  options: WithCloudflareWorkflowsOptions = {},
): SideffectWorkflowsPlugin {
  const { worker, workflowPaths = ["src/workflows"], config, ...pluginConfig } = options;
  const captured: { value?: CapturedWorkflowConfig } = {};
  let configRoot: string | undefined;
  let resolvedConfig: { readonly root: string } | undefined;

  const plugin: SideffectWorkflowsPlugin = {
    name: "sideffect:cloudflare-workflows",
    enforce: "pre",
    sharedDuringBuild: true,
    cloudflare: {
      ...pluginConfig,
      config(workerConfig: WorkerConfig, ...args: Array<any>) {
        const configResult = typeof config === "function" ? config(workerConfig, ...args) : config;
        const configured = configResult
          ? (defu(configResult, workerConfig) as WorkerConfig)
          : workerConfig;
        const sourceMain = worker ?? configured.main;

        if (typeof sourceMain !== "string" || sourceMain.length === 0) {
          throw new Error(
            'withCloudflareWorkflows could not determine the original Worker entry module. Configure Cloudflare\'s main field or pass worker: "./src/index.ts".',
          );
        }

        if (sourceMain === virtualEntry) {
          throw new Error(
            `withCloudflareWorkflows captured "${virtualEntry}" as the original Worker entry. Keep Wrangler main pointed at your real Worker file, then let Sideffect replace it during Vite config resolution.`,
          );
        }

        const root = configRoot ?? process.cwd();
        const baseDirectory =
          typeof plugin.cloudflare.configPath === "string"
            ? dirname(resolve(root, plugin.cloudflare.configPath))
            : root;
        const discoveredWorkflows = collectWorkflowEntries(workflowPaths, baseDirectory);
        const discoveredByClassName = new Map(
          discoveredWorkflows.map((workflow) => [workflow.config.class_name, workflow]),
        );
        const configuredWorkflows = Array.isArray(configured.workflows)
          ? (configured.workflows as Array<WorkflowConfigEntry>)
          : [];
        const mergedWorkflows = [
          ...configuredWorkflows,
          ...discoveredWorkflows.map((workflow) => workflow.config),
        ];
        const localWorkflows = mergedWorkflows.filter(
          (entry) => !entry.script_name || entry.script_name === configured.name,
        );

        const seenClassNames = new Set<string>();
        for (const entry of localWorkflows) {
          validateWorkflowExportName(entry.class_name);
          if (seenClassNames.has(entry.class_name)) {
            throw new Error(
              `Duplicate local Cloudflare Workflow class_name "${entry.class_name}". Each workflow exported by one Worker must have a unique class_name so Sideffect can generate named exports.`,
            );
          }
          seenClassNames.add(entry.class_name);
        }

        captured.value = {
          sourceMain,
          workflows: localWorkflows.map(
            (entry) =>
              discoveredByClassName.get(entry.class_name) ?? { kind: "native", config: entry },
          ),
        };

        writeWorkflowEnvTypes(baseDirectory, captured.value.workflows);

        Object.assign(workerConfig as Record<string, unknown>, configured, {
          main: virtualEntry,
          workflows: mergedWorkflows,
        });
      },
    },
    config(config) {
      configRoot = resolve(config.root ?? process.cwd());
    },
    configResolved(config) {
      resolvedConfig = config;
    },
    resolveId(source) {
      if (source !== virtualEntry) {
        return;
      }

      return resolvedVirtualEntry;
    },
    async load(id) {
      if (id !== resolvedVirtualEntry) {
        return;
      }

      if (!resolvedConfig) {
        throw new Error(
          "Sideffect could not load virtual:sideffect/entry because Vite config has not been resolved yet. This is an internal Vite plugin ordering error.",
        );
      }

      if (!captured.value?.sourceMain) {
        throw new Error(
          "Sideffect could not generate virtual:sideffect/entry because Cloudflare config was not captured. Use withCloudflareWorkflows(cloudflare) so Sideffect can configure Cloudflare's Vite plugin before it resolves the Worker entry.",
        );
      }

      for (const workflow of captured.value.workflows) {
        validateWorkflowExportName(workflow.config.class_name);
      }

      const baseDirectory =
        typeof plugin.cloudflare.configPath === "string"
          ? dirname(resolve(resolvedConfig.root, plugin.cloudflare.configPath))
          : resolvedConfig.root;
      const importer = resolve(baseDirectory, "__sideffect_virtual_entry__.ts");
      const source = captured.value.sourceMain;
      const specifier =
        source.startsWith(".") ||
        source.startsWith("/") ||
        source.includes(":") ||
        !/\.[cm]?[jt]sx?$/.test(source)
          ? source
          : `./${source}`;
      const resolved = await this.resolve(specifier, importer, { skipSelf: true });

      if (!resolved) {
        throw new Error(
          `Sideffect could not resolve the original Worker entry "${source}" from "${baseDirectory}" while generating virtual:sideffect/entry. Check Wrangler main or pass withCloudflareWorkflows(cloudflare, { worker: "./src/index.ts" }).`,
        );
      }

      return generateVirtualEntryModule({
        workerImport: resolved.id.replace(/\\/g, "/"),
        workflows: captured.value.workflows,
      });
    },
  };

  return plugin;
}
