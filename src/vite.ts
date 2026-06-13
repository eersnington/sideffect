import type { WorkflowBindingDescriptors, WorkflowConfigEntry } from "./types.ts";

export interface WorkerConfig {
  readonly main?: string;
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

export interface WithCloudflareWorkflowsOptions extends CloudflarePluginConfig {
  readonly worker?: string;
  readonly workflows: WorkflowBindingDescriptors;
}

export function withCloudflareWorkflows(
  options: WithCloudflareWorkflowsOptions,
): CloudflarePluginConfig {
  const { worker, workflows, config, ...pluginConfig } = options;
  const entries = workflowConfigEntries(workflows);
  const main = "virtual:sideffect/entry";

  return {
    ...pluginConfig,
    config(workerConfig: WorkerConfig, ...args: Array<any>) {
      const configured = applyConfigCustomizer(config, workerConfig, args);
      const sourceMain = worker ?? configured.main;

      if (typeof sourceMain !== "string" || sourceMain.length === 0) {
        throw new Error(
          'withCloudflareWorkflows could not determine the Worker entry module. Pass worker: "./src/index.ts" or configure Cloudflare\'s main field.',
        );
      }

      return {
        ...configured,
        main,
        workflows: mergeWorkflowEntries(configured.workflows, entries),
        sideffect: {
          worker: sourceMain,
          workflows,
          virtualMain: main,
        },
      };
    },
  };
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
