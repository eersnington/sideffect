import { dirname, join, resolve } from "node:path";

import { validateWorkflowExportName } from "./entrypoints.ts";
import type { WorkflowConfigEntry } from "./types.ts";

const virtualEntry = "virtual:sideffect/entry";
const resolvedVirtualEntry = `\0${virtualEntry}`;

export interface WorkerConfig {
  readonly main?: string;
  readonly name?: string;
  readonly workflows?: Array<WorkflowConfigEntry>;
  readonly [key: string]: unknown;
}

export type WorkerConfigCustomizer =
  | Partial<WorkerConfig>
  | ((config: WorkerConfig, ...args: Array<any>) => Partial<WorkerConfig> | void);

export interface CloudflarePluginConfig {
  readonly config?: WorkerConfigCustomizer;
  readonly configPath?: string;
  readonly auxiliaryWorkers?: Array<unknown>;
  readonly [key: string]: unknown;
}

export interface WorkflowBindingDescriptor {
  readonly module: string;
  readonly export: string;
  readonly className?: string;
}

export type WorkflowBindingDescriptors = Record<string, WorkflowBindingDescriptor>;

export interface WithCloudflareWorkflowsOptions extends CloudflarePluginConfig {
  readonly worker?: string;
  readonly workflows?: WorkflowBindingDescriptors;
}

export interface SideffectWorkflowsPlugin extends Plugin {
  readonly cloudflare: CloudflarePluginConfig;
}

export interface Plugin {
  readonly name: string;
  readonly enforce?: "pre" | "post";
  readonly sharedDuringBuild?: boolean;
  configResolved?(config: { readonly root: string }): void;
  resolveId?(source: string): string | void;
  load?(this: ResolveContext, id: string): Promise<string | void> | string | void;
}

interface CapturedWorkflowConfig {
  readonly sourceMain?: string;
  readonly workerName?: string;
  readonly workflows: Array<WorkflowConfigEntry>;
}

interface ResolvedVirtualEntryConfig {
  readonly workerImport: string;
  readonly workflowClassNames: Array<string>;
}

interface ResolveContext {
  resolve(
    source: string,
    importer?: string,
    options?: { readonly skipSelf?: boolean },
  ): Promise<{ readonly id: string } | null>;
}

export function withCloudflareWorkflows(
  options: WithCloudflareWorkflowsOptions = {},
): SideffectWorkflowsPlugin {
  const { worker, workflows, config, ...pluginConfig } = options;
  const programmaticWorkflowEntries = workflows ? workflowConfigEntries(workflows) : [];
  const captured: { value?: CapturedWorkflowConfig } = {};
  let resolvedConfig: { readonly root: string } | undefined;

  const plugin: SideffectWorkflowsPlugin = {
    name: "sideffect:cloudflare-workflows",
    enforce: "pre",
    sharedDuringBuild: true,
    cloudflare: {
      ...pluginConfig,
      config(workerConfig: WorkerConfig, ...args: Array<any>) {
        const configured = applyConfigCustomizer(config, workerConfig, args);
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

        const mergedWorkflows = mergeWorkflowEntries(
          configured.workflows,
          programmaticWorkflowEntries,
        );
        captured.value = {
          sourceMain,
          workerName: configured.name,
          workflows: localWorkflowEntries(mergedWorkflows, configured.name),
        };

        assertUniqueWorkflowClassNames(captured.value.workflows);

        return {
          ...configured,
          main: virtualEntry,
          workflows: mergedWorkflows,
        };
      },
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

      const virtualConfig = await resolveVirtualEntryConfig(
        this,
        resolvedConfig.root,
        plugin.cloudflare.configPath,
        captured.value,
      );

      return generateVirtualEntryModule(virtualConfig);
    },
  };

  return plugin;
}

export function workflowConfigEntries(
  workflows: WorkflowBindingDescriptors,
): Array<WorkflowConfigEntry> {
  return Object.entries(workflows).map(([binding, descriptor]) => ({
    binding,
    name: descriptorName(descriptor.module),
    class_name: descriptor.className ?? binding,
  }));
}

async function resolveVirtualEntryConfig(
  context: ResolveContext,
  root: string,
  configPath: unknown,
  captured: CapturedWorkflowConfig | undefined,
): Promise<ResolvedVirtualEntryConfig> {
  if (!captured?.sourceMain) {
    throw new Error(
      "Sideffect could not generate virtual:sideffect/entry because Cloudflare config was not captured. Use cloudflare(sideffect.cloudflare) with the same object returned by withCloudflareWorkflows().",
    );
  }

  const workflowClassNames = captured.workflows.map((workflow) => workflow.class_name);
  for (const className of workflowClassNames) {
    validateWorkflowExportName(className);
  }

  const baseDirectory = typeof configPath === "string" ? dirname(resolve(root, configPath)) : root;
  const importer = join(baseDirectory, "__sideffect_virtual_entry__.ts");
  const resolved = await context.resolve(captured.sourceMain, importer, { skipSelf: true });

  if (!resolved) {
    throw new Error(
      `Sideffect could not resolve the original Worker entry "${captured.sourceMain}" from "${baseDirectory}" while generating virtual:sideffect/entry. Check Wrangler main or pass withCloudflareWorkflows({ worker: "./src/index.ts" }).`,
    );
  }

  return {
    workerImport: normalizePath(resolved.id),
    workflowClassNames,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function generateVirtualEntryModule(config: ResolvedVirtualEntryConfig): string {
  const entries = config.workflowClassNames
    .map((className) => {
      const literal = JSON.stringify(className);
      return `  ${className}: __sideffectWorkflowLayer(__sideffect_worker, ${literal}, ${JSON.stringify(config.workerImport)}),`;
    })
    .join("\n");
  const exports = config.workflowClassNames
    .map((className) => `export const ${className} = __sideffect_entrypoints.${className};`)
    .join("\n");

  return `import { WorkflowEntrypoints } from "sideffect/cloudflare";
import * as __sideffect_worker from ${JSON.stringify(config.workerImport)};

export * from ${JSON.stringify(config.workerImport)};
export default __sideffect_worker.default ?? {};

function __sideffectWorkflowLayer(module, className, modulePath) {
  const layer = module[className];
  if (!layer || layer._tag !== "WorkflowLayer") {
    throw new TypeError(\`Expected Worker export "\${className}" from "\${modulePath}" to be a Sideffect WorkflowLayer. Export a layer with the same name as the Wrangler workflow class_name, for example: export { resizeImageWorkflowLayer as \${className} } from "./workflows/resize-image".\`);
  }
  return layer;
}

const __sideffect_entrypoints = WorkflowEntrypoints.make({
${entries}
});

${exports}
`;
}

function descriptorName(modulePath: string): string {
  const baseName = modulePath
    .split("/")
    .at(-1)
    ?.replace(/\.[cm]?[jt]sx?$/, "");

  if (!baseName) {
    throw new Error(`Could not infer a Cloudflare workflow name from module path "${modulePath}".`);
  }

  return baseName;
}

function applyConfigCustomizer(
  config: CloudflarePluginConfig["config"],
  workerConfig: WorkerConfig,
  args: Array<any>,
): WorkerConfig {
  if (typeof config === "function") {
    const result = config(workerConfig, ...args);
    return result ? { ...workerConfig, ...result } : workerConfig;
  }

  return config ? { ...workerConfig, ...config } : workerConfig;
}

function mergeWorkflowEntries(
  existing: unknown,
  entries: Array<WorkflowConfigEntry>,
): Array<WorkflowConfigEntry> {
  if (!Array.isArray(existing)) {
    return entries;
  }

  return [...existing, ...entries] as Array<WorkflowConfigEntry>;
}

function localWorkflowEntries(
  entries: Array<WorkflowConfigEntry>,
  workerName: string | undefined,
): Array<WorkflowConfigEntry> {
  return entries.filter((entry) => !entry.script_name || entry.script_name === workerName);
}

function assertUniqueWorkflowClassNames(entries: Array<WorkflowConfigEntry>): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    validateWorkflowExportName(entry.class_name);
    if (seen.has(entry.class_name)) {
      throw new Error(
        `Duplicate local Cloudflare Workflow class_name "${entry.class_name}". Each workflow exported by one Worker must have a unique class_name so Sideffect can generate named exports.`,
      );
    }
    seen.add(entry.class_name);
  }
}
