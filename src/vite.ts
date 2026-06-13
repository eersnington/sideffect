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
