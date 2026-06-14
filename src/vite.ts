import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

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
export type WorkflowDiscoveryPatterns = Array<string>;

export interface WithCloudflareWorkflowsOptions extends CloudflarePluginConfig {
  readonly worker?: string;
  readonly workflows?: WorkflowBindingDescriptors | WorkflowDiscoveryPatterns;
}

export type CloudflarePluginFactory<Result = unknown> = (config?: any) => Result;

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
  readonly workflows: Array<CapturedWorkflow>;
}

interface CapturedWorkflow {
  readonly config: WorkflowConfigEntry;
  readonly layer?: WorkflowLayerImport;
}

interface WorkflowLayerImport {
  readonly modulePath: string;
  readonly exportName: string;
}

interface ResolvedVirtualEntryConfig {
  readonly workerImport: string;
  readonly workflows: Array<CapturedWorkflow>;
}

interface ResolveContext {
  resolve(
    source: string,
    importer?: string,
    options?: { readonly skipSelf?: boolean },
  ): Promise<{ readonly id: string } | null>;
}

export function withCloudflareWorkflows<Result>(
  cloudflare: CloudflarePluginFactory<Result>,
  options: WithCloudflareWorkflowsOptions = {},
): Array<Plugin | Result> {
  const sideffect = createSideffectWorkflowsPlugin(options);
  return [sideffect, cloudflare(sideffect.cloudflare)];
}

export interface SideffectWorkflowsPlugin extends Plugin {
  readonly cloudflare: CloudflarePluginConfig;
}

export function createSideffectWorkflowsPlugin(
  options: WithCloudflareWorkflowsOptions = {},
): SideffectWorkflowsPlugin {
  const { worker, workflows, config, ...pluginConfig } = options;
  const programmaticWorkflowEntries = workflows
    ? Array.isArray(workflows)
      ? []
      : workflowConfigEntries(workflows)
    : [];
  const workflowPatterns = Array.isArray(workflows) ? workflows : ["src/workflows"];
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

        const configuredWorkflowEntries = Array.isArray(configured.workflows)
          ? (configured.workflows as Array<WorkflowConfigEntry>)
          : [];
        const shouldDiscoverWorkflows =
          configuredWorkflowEntries.length === 0 && programmaticWorkflowEntries.length === 0;
        const baseDirectory = baseDirectoryForConfig(
          resolvedConfig?.root,
          plugin.cloudflare.configPath,
        );
        const discoveredWorkflows = shouldDiscoverWorkflows
          ? collectWorkflowEntries(workflowPatterns, baseDirectory)
          : [];
        const discoveredWorkflowEntries = discoveredWorkflows.map((workflow) => workflow.config);
        const mergedWorkflows = mergeWorkflowEntries(configured.workflows, [
          ...discoveredWorkflowEntries,
          ...programmaticWorkflowEntries,
        ]);
        captured.value = {
          sourceMain,
          workerName: configured.name,
          workflows: capturedLocalWorkflowEntries(
            mergedWorkflows,
            discoveredWorkflows,
            configured.name,
          ),
        };

        assertUniqueWorkflowClassNames(captured.value.workflows.map((workflow) => workflow.config));
        writeWorkflowEnvTypes(baseDirectory, captured.value.workflows);

        Object.assign(workerConfig as Record<string, unknown>, configured, {
          main: virtualEntry,
          workflows: mergedWorkflows,
        });

        return;
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

export function collectWorkflowEntries(
  patterns: WorkflowDiscoveryPatterns | string = ["src/workflows"],
  baseDirectory: string = process.cwd(),
): Array<CapturedWorkflow> {
  const roots = Array.isArray(patterns) ? patterns : [patterns];
  return dedupeCapturedWorkflows(
    roots.flatMap((pattern) => collectWorkflowEntriesFromPath(pattern, baseDirectory)),
  );
}

async function resolveVirtualEntryConfig(
  context: ResolveContext,
  root: string,
  configPath: unknown,
  captured: CapturedWorkflowConfig | undefined,
): Promise<ResolvedVirtualEntryConfig> {
  if (!captured?.sourceMain) {
    throw new Error(
      "Sideffect could not generate virtual:sideffect/entry because Cloudflare config was not captured. Use withCloudflareWorkflows(cloudflare) so Sideffect can configure Cloudflare's Vite plugin before it resolves the Worker entry.",
    );
  }

  const workflowClassNames = captured.workflows.map((workflow) => workflow.config.class_name);
  for (const className of workflowClassNames) {
    validateWorkflowExportName(className);
  }

  const baseDirectory = baseDirectoryForConfig(root, configPath);
  const importer = join(baseDirectory, "__sideffect_virtual_entry__.ts");
  const resolved = await context.resolve(resolveSpecifier(captured.sourceMain), importer, {
    skipSelf: true,
  });

  if (!resolved) {
    throw new Error(
      `Sideffect could not resolve the original Worker entry "${captured.sourceMain}" from "${baseDirectory}" while generating virtual:sideffect/entry. Check Wrangler main or pass withCloudflareWorkflows(cloudflare, { worker: "./src/index.ts" }).`,
    );
  }

  return {
    workerImport: normalizePath(resolved.id),
    workflows: captured.workflows,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function baseDirectoryForConfig(root: string | undefined, configPath: unknown): string {
  const resolvedRoot = root ?? process.cwd();
  return typeof configPath === "string" ? dirname(resolve(resolvedRoot, configPath)) : resolvedRoot;
}

function resolveSpecifier(specifier: string): string {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.includes(":") ||
    !/\.[cm]?[jt]sx?$/.test(specifier)
  ) {
    return specifier;
  }

  return `./${specifier}`;
}

function generateVirtualEntryModule(config: ResolvedVirtualEntryConfig): string {
  const workflowImports = config.workflows
    .map((workflow, index) => {
      if (!workflow.layer) {
        return undefined;
      }

      return `import { ${workflow.layer.exportName} as __sideffect_workflow_${index} } from ${JSON.stringify(workflow.layer.modulePath)};`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const entries = config.workflows
    .map((workflow, index) => {
      const className = workflow.config.class_name;
      const literal = JSON.stringify(className);
      const moduleExpression = workflow.layer
        ? `__sideffect_workflow_${index}`
        : `__sideffect_worker`;
      const modulePath = workflow.layer?.modulePath ?? config.workerImport;
      const exportName = workflow.layer ? "default" : className;
      return `  ${className}: __sideffectWorkflowLayer(${moduleExpression}, ${JSON.stringify(exportName)}, ${literal}, ${JSON.stringify(modulePath)}),`;
    })
    .join("\n");
  const exports = config.workflows
    .map(
      (workflow) =>
        `export const ${workflow.config.class_name} = __sideffect_entrypoints.${workflow.config.class_name};`,
    )
    .join("\n");

  return `import { WorkflowEntrypoints } from "sideffect/cloudflare";
import * as __sideffect_worker from ${JSON.stringify(config.workerImport)};
${workflowImports}

export * from ${JSON.stringify(config.workerImport)};
export default __sideffect_worker.default ?? {};

function __sideffectWorkflowLayer(module, exportName, className, modulePath) {
  const layer = exportName === "default" ? module : module[exportName];
  if (!layer || layer._tag !== "WorkflowLayer") {
    throw new TypeError(\`Expected workflow "\${className}" from "\${modulePath}" to be a Sideffect WorkflowLayer. Export a layer with Workflow.make({ name }).toLayer(...).\`);
  }
  return layer;
}

const __sideffect_entrypoints = WorkflowEntrypoints.make({
${entries}
});

${exports}
`;
}

function writeWorkflowEnvTypes(root: string, workflows: Array<CapturedWorkflow>): void {
  if (!workflows.some((workflow) => workflow.layer)) {
    return;
  }

  writeFileSync(join(root, "sideffect-env.d.ts"), generateWorkflowEnvTypes(root, workflows));
}

function generateWorkflowEnvTypes(root: string, workflows: Array<CapturedWorkflow>): string {
  const imports = workflows
    .map((workflow, index) => {
      if (!workflow.layer) {
        return undefined;
      }

      return `import type { ${workflow.layer.exportName} as __SideffectWorkflow${index} } from ${JSON.stringify(relativeTypeImport(root, workflow.layer.modulePath))};`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const envBindings = workflows
    .map((workflow, index) => {
      const payload = workflow.layer
        ? `__SideffectWorkflowPayload<typeof __SideffectWorkflow${index}>`
        : "unknown";
      return `    ${workflow.config.binding}: CloudflareWorkflow<${payload}>;`;
    })
    .join("\n");
  const cloudflareEnvBindings = workflows
    .map((workflow, index) => {
      const payload = workflow.layer
        ? `__SideffectWorkflowPayload<typeof __SideffectWorkflow${index}>`
        : "unknown";
      return `      ${workflow.config.binding}: CloudflareWorkflow<${payload}>;`;
    })
    .join("\n");

  return `// Generated by Sideffect. Do not edit.
import type { Workflow as CloudflareWorkflow } from "cloudflare:workers";
import type { WorkflowLayer } from "sideffect";
${imports}

type __SideffectWorkflowPayload<T> = T extends WorkflowLayer<infer Payload, any> ? Payload : never;

declare global {
  interface Env {
${envBindings}
  }

  namespace Cloudflare {
    interface Env {
${cloudflareEnvBindings}
    }
  }
}

export {};
`;
}

function relativeTypeImport(root: string, modulePath: string): string {
  const path = relative(root, modulePath)
    .replace(/\\/g, "/")
    .replace(/\.[cm]?[jt]sx?$/, "");

  return path.startsWith(".") ? path : `./${path}`;
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

function collectWorkflowEntriesFromPath(
  pattern: string,
  baseDirectory: string,
): Array<CapturedWorkflow> {
  const root = resolve(baseDirectory, pattern.replace(/\*.*$/, ""));
  if (!existsSync(root)) {
    return [];
  }

  return sourceFiles(root).flatMap((filePath) =>
    collectWorkflowEntriesFromFile(filePath, new Set()),
  );
}

function sourceFiles(path: string): Array<string> {
  if (!existsSync(path)) {
    return [];
  }

  if (isSourceFile(path)) {
    return [path];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : isSourceFile(child) ? [child] : [];
  });
}

function isSourceFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}

function collectWorkflowEntriesFromFile(
  filePath: string,
  visited: Set<string>,
): Array<CapturedWorkflow> {
  if (visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  const source = readFileSync(filePath, "utf8");
  const entries: Array<CapturedWorkflow> = [];

  for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g)) {
    const specifier = match[2];
    if (!specifier || isExternalModuleSpecifier(specifier)) {
      continue;
    }
    const resolved = resolveSourceFile(dirname(filePath), specifier);
    if (!resolved) {
      throw new Error(
        `Sideffect could not resolve workflow re-export module "${specifier}" from "${filePath}" while generating Cloudflare workflow bindings.`,
      );
    }

    const moduleWorkflows = collectLocalWorkflowExports(resolved);
    for (const exportEntry of parseExportSpecifiers(match[1] ?? "")) {
      const workflowName = moduleWorkflows.get(exportEntry.imported);
      if (!workflowName) {
        continue;
      }
      entries.push(capturedWorkflow(workflowName, resolved, exportEntry.imported));
    }
  }

  const localWorkflows = collectLocalWorkflowExports(filePath);
  for (const [exportName, workflowName] of localWorkflows) {
    entries.push(capturedWorkflow(workflowName, filePath, exportName));
  }

  return dedupeCapturedWorkflows(entries);
}

function collectLocalWorkflowExports(filePath: string): Map<string, string> {
  const source = readFileSync(filePath, "utf8");
  const workflowDefinitions = new Map<string, string>();
  const workflowLayers = new Map<string, string>();
  const exported = new Set<string>();

  for (const match of source.matchAll(
    /(?:export\s+)?const\s+([A-Z_a-z$][\w$]*)\s*=\s*Workflow\.make\s*\(\s*\{[\s\S]*?\bname\s*:\s*["']([^"']+)["'][\s\S]*?\}\s*\)/g,
  )) {
    if (match[1] && match[2]) {
      workflowDefinitions.set(match[1], match[2]);
    }
  }

  for (const match of source.matchAll(
    /export\s+const\s+([A-Z_a-z$][\w$]*)\s*=\s*Workflow\.make\s*\(\s*\{[\s\S]*?\bname\s*:\s*["']([^"']+)["'][\s\S]*?\}\s*\)\.toLayer\s*\(/g,
  )) {
    if (match[1] && match[2]) {
      workflowLayers.set(match[1], match[2]);
      exported.add(match[1]);
    }
  }

  for (const match of source.matchAll(
    /(export\s+)?const\s+([A-Z_a-z$][\w$]*)\s*=\s*([A-Z_a-z$][\w$]*)\.toLayer\s*\(/g,
  )) {
    const exportKeyword = match[1];
    const layerName = match[2];
    const workflowVariable = match[3];
    const workflowName = workflowVariable ? workflowDefinitions.get(workflowVariable) : undefined;
    if (layerName && workflowName) {
      workflowLayers.set(layerName, workflowName);
      if (exportKeyword) {
        exported.add(layerName);
      }
    }
  }

  for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
    for (const exportEntry of parseExportSpecifiers(match[1] ?? "")) {
      const workflowName = workflowLayers.get(exportEntry.imported);
      if (workflowName) {
        workflowLayers.set(exportEntry.exported, workflowName);
        exported.add(exportEntry.exported);
      }
    }
  }

  return new Map([...workflowLayers].filter(([name]) => exported.has(name)));
}

function parseExportSpecifiers(specifiers: string): Array<{ imported: string; exported: string }> {
  return specifiers
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const [imported, exported] = specifier.split(/\s+as\s+/);
      const name = imported?.trim() ?? "";
      return { imported: name, exported: exported?.trim() ?? name };
    })
    .filter(
      (specifier) => isIdentifierName(specifier.imported) && isIdentifierName(specifier.exported),
    );
}

function capturedWorkflow(
  workflowName: string,
  filePath: string,
  exportName: string,
): CapturedWorkflow {
  const className = classNameFromWorkflowName(workflowName);
  return {
    config: workflowConfigEntry(className, workflowName),
    layer: {
      modulePath: normalizePath(filePath),
      exportName,
    },
  };
}

function workflowConfigEntry(className: string, workflowName: string): WorkflowConfigEntry {
  validateWorkflowExportName(className);
  return {
    binding: bindingName(workflowName),
    name: workflowName,
    class_name: className,
  };
}

function classNameFromWorkflowName(workflowName: string): string {
  return workflowName
    .split(/[^A-Z_a-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function bindingName(workflowName: string): string {
  return workflowName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Z_a-z0-9]+/g, "_")
    .toUpperCase();
}

function dedupeCapturedWorkflows(entries: Array<CapturedWorkflow>): Array<CapturedWorkflow> {
  const byClassName = new Map<string, CapturedWorkflow>();
  for (const entry of entries) {
    byClassName.set(entry.config.class_name, entry);
  }
  return [...byClassName.values()];
}

function resolveSourceFile(baseDirectory: string, specifier: string): string | undefined {
  const basePath = resolve(baseDirectory, specifier);
  const candidates = extname(basePath)
    ? [basePath]
    : [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
        join(basePath, "index.js"),
        join(basePath, "index.jsx"),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isExternalModuleSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function isIdentifierName(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
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

function capturedLocalWorkflowEntries(
  entries: Array<WorkflowConfigEntry>,
  discovered: Array<CapturedWorkflow>,
  workerName: string | undefined,
): Array<CapturedWorkflow> {
  const discoveredByClassName = new Map(
    discovered.map((workflow) => [workflow.config.class_name, workflow]),
  );

  return localWorkflowEntries(entries, workerName).map(
    (entry) => discoveredByClassName.get(entry.class_name) ?? { config: entry },
  );
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
