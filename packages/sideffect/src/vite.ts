import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

import { defu } from "defu";
import ts from "typescript";

import { validateWorkflowExportName } from "./entrypoints.ts";
import type { WorkflowConfigEntry } from "./types.ts";

const virtualEntry = "virtual:sideffect/entry";
const resolvedVirtualEntry = `\0${virtualEntry}`;
const sourceFileExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const declarationFileExtensions = [".d.ts", ".d.mts", ".d.cts"];

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
  readonly viteEnvironment?: unknown;
}

export type WorkflowDiscoveryPaths = Array<string>;

export interface WithCloudflareWorkflowsOptions extends CloudflarePluginConfig {
  readonly worker?: string;
  readonly workflowPaths?: WorkflowDiscoveryPaths;
}

export type CloudflarePluginFactory<Result = unknown> = (config?: any) => Result;

export interface Plugin {
  readonly name: string;
  readonly enforce?: "pre" | "post";
  readonly sharedDuringBuild?: boolean;
  config?(config: { readonly root?: string }): void;
  configResolved?(config: { readonly root: string }): void;
  resolveId?(source: string): string | void;
  load?(this: ResolveContext, id: string): Promise<string | void> | string | void;
}

interface CapturedWorkflowConfig {
  readonly sourceMain?: string;
  readonly workerName?: string;
  readonly workflows: Array<CapturedWorkflow>;
}

interface CapturedSideffectWorkflow {
  readonly kind: "sideffect";
  readonly config: WorkflowConfigEntry;
  readonly layer: WorkflowLayerImport;
}

interface CapturedNativeWorkflow {
  readonly kind: "native";
  readonly config: WorkflowConfigEntry;
}

type CapturedWorkflow = CapturedSideffectWorkflow | CapturedNativeWorkflow;

interface WorkflowLayerImport {
  readonly modulePath: string;
  readonly exportName: string;
}

interface DiscoveredWorkflowExport {
  readonly workflowName: string;
  readonly modulePath: string;
  readonly exportName: string;
}

type ReExportDeclaration =
  | {
      readonly kind: "named";
      readonly specifier: string;
      readonly exports: Array<{ readonly imported: string; readonly exported: string }>;
    }
  | { readonly kind: "all"; readonly specifier: string };

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

        const baseDirectory = baseDirectoryForConfig(configRoot, plugin.cloudflare.configPath);
        const discoveredWorkflows = collectWorkflowEntries(workflowPaths, baseDirectory);
        const discoveredWorkflowEntries = discoveredWorkflows.map((workflow) => workflow.config);
        const mergedWorkflows = mergeWorkflowEntries(
          configured.workflows,
          discoveredWorkflowEntries,
        );
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

export function collectWorkflowEntries(
  patterns: WorkflowDiscoveryPaths | string = ["src/workflows"],
  baseDirectory: string = process.cwd(),
): Array<CapturedSideffectWorkflow> {
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
  const sideffectWorkflows = config.workflows.filter(isSideffectWorkflow);

  if (sideffectWorkflows.length === 0) {
    return `import * as __sideffect_worker from ${JSON.stringify(config.workerImport)};

export * from ${JSON.stringify(config.workerImport)};
export default __sideffect_worker.default ?? {};
`;
  }

  const workflowImports = sideffectWorkflows
    .map((workflow, index) => {
      return `import { ${workflow.layer.exportName} as __sideffect_workflow_${index} } from ${JSON.stringify(workflow.layer.modulePath)};`;
    })
    .join("\n");
  const entries = sideffectWorkflows
    .map((workflow, index) => {
      const className = workflow.config.class_name;
      const literal = JSON.stringify(className);
      return `  ${className}: __sideffectWorkflowLayer(__sideffect_workflow_${index}, ${JSON.stringify("default")}, ${literal}, ${JSON.stringify(workflow.layer.modulePath)}),`;
    })
    .join("\n");
  const exports = sideffectWorkflows
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
  const sideffectWorkflows = workflows.filter(isSideffectWorkflow);
  if (sideffectWorkflows.length === 0) {
    return;
  }

  writeFileSync(
    join(root, "sideffect-env.d.ts"),
    generateWorkflowEnvTypes(root, sideffectWorkflows),
  );
}

function generateWorkflowEnvTypes(
  root: string,
  workflows: Array<CapturedSideffectWorkflow>,
): string {
  const imports = workflows
    .map((workflow, index) => {
      return `import type { ${workflow.layer.exportName} as __SideffectWorkflow${index} } from ${JSON.stringify(relativeTypeImport(root, workflow.layer.modulePath))};`;
    })
    .join("\n");
  const envBindings = workflows
    .map((workflow, index) => {
      const payload = `__SideffectWorkflowPayload<typeof __SideffectWorkflow${index}>`;
      return `    ${workflow.config.binding}: __SideffectCloudflareWorkflow<${payload}>;`;
    })
    .join("\n");
  const cloudflareEnvBindings = workflows
    .map((workflow, index) => {
      const payload = `__SideffectWorkflowPayload<typeof __SideffectWorkflow${index}>`;
      return `      ${workflow.config.binding}: __SideffectCloudflareWorkflow<${payload}>;`;
    })
    .join("\n");

  return `// Generated by Sideffect. Do not edit.
import type { WorkflowLayer } from "sideffect";
${imports}

type __SideffectCloudflareWorkflow<Payload> = Workflow<Payload>;
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

function collectWorkflowEntriesFromPath(
  pattern: string,
  baseDirectory: string,
): Array<CapturedSideffectWorkflow> {
  const root = resolve(baseDirectory, pattern.replace(/\*.*$/, ""));
  if (!existsSync(root)) {
    return [];
  }

  return sourceFiles(root).flatMap((filePath) =>
    collectWorkflowEntriesFromFile(filePath, new Set()),
  );
}

function sourceFiles(path: string): Array<string> {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) {
    return [];
  }

  if (stats.isFile()) {
    return isSourceFile(path) ? [path] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(child);
      }
      if (entry.isFile() && isSourceFile(child)) {
        return [child];
      }
      return [];
    });
}

function isSourceFile(path: string): boolean {
  return (
    sourceFileExtensions.has(extname(path)) &&
    !declarationFileExtensions.some((extension) => path.endsWith(extension))
  );
}

function collectWorkflowEntriesFromFile(
  filePath: string,
  visited: Set<string>,
): Array<CapturedSideffectWorkflow> {
  return dedupeCapturedWorkflows(
    [...collectWorkflowExportsFromFile(filePath, visited).values()].map((workflow) =>
      capturedWorkflow(workflow.workflowName, workflow.modulePath, workflow.exportName),
    ),
  );
}

function collectWorkflowExportsFromFile(
  filePath: string,
  visited: Set<string>,
): Map<string, DiscoveredWorkflowExport> {
  if (visited.has(filePath)) {
    return new Map();
  }
  visited.add(filePath);

  const analysis = analyzeWorkflowSourceFile(filePath);
  const exports = new Map(analysis.exports);

  for (const reExport of analysis.reExports) {
    if (isExternalModuleSpecifier(reExport.specifier)) {
      continue;
    }

    const resolved = resolveSourceFile(dirname(filePath), reExport.specifier);
    if (!resolved) {
      throw new Error(
        `Sideffect could not resolve workflow re-export module "${reExport.specifier}" from "${filePath}" while generating Cloudflare workflow bindings.`,
      );
    }

    const targetExports = collectWorkflowExportsFromFile(resolved, visited);
    if (reExport.kind === "all") {
      for (const [exportName, workflow] of targetExports) {
        exports.set(exportName, workflow);
      }
      continue;
    }

    for (const exportEntry of reExport.exports) {
      const workflow = targetExports.get(exportEntry.imported);
      if (workflow) {
        exports.set(exportEntry.exported, workflow);
      }
    }
  }

  return exports;
}

function analyzeWorkflowSourceFile(filePath: string): {
  readonly exports: Map<string, DiscoveredWorkflowExport>;
  readonly reExports: Array<ReExportDeclaration>;
} {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKindForFile(filePath),
  );
  const workflowBindings = collectWorkflowBindings(sourceFile);
  const workflowDefinitions = new Map<string, string>();
  const workflowLayers = new Map<string, string>();
  const exports = new Map<string, DiscoveredWorkflowExport>();
  const reExports: Array<ReExportDeclaration> = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const exported = hasExportModifier(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }

        const name = declaration.name.text;
        const workflowName = workflowNameFromMakeCall(declaration.initializer, workflowBindings);
        if (workflowName) {
          workflowDefinitions.set(name, workflowName);
          continue;
        }

        const layerWorkflowName = workflowNameFromLayerExpression(
          declaration.initializer,
          workflowBindings,
          workflowDefinitions,
        );
        if (!layerWorkflowName) {
          continue;
        }

        workflowLayers.set(name, layerWorkflowName);
        if (exported) {
          exports.set(name, discoveredWorkflow(layerWorkflowName, filePath, name));
        }
      }
      continue;
    }

    if (!ts.isExportDeclaration(statement)) {
      continue;
    }

    const specifier = moduleSpecifierText(statement.moduleSpecifier);
    if (specifier) {
      const exportClause = statement.exportClause;
      if (!exportClause) {
        reExports.push({ kind: "all", specifier });
      } else if (ts.isNamedExports(exportClause)) {
        const namedExports = exportSpecifierNames(statement, exportClause);
        if (namedExports.length > 0) {
          reExports.push({ kind: "named", specifier, exports: namedExports });
        }
      }
      continue;
    }

    if (
      statement.isTypeOnly ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }

    for (const exportEntry of exportSpecifierNames(statement, statement.exportClause)) {
      const workflowName = workflowLayers.get(exportEntry.imported);
      if (workflowName) {
        exports.set(
          exportEntry.exported,
          discoveredWorkflow(workflowName, filePath, exportEntry.exported),
        );
      }
    }
  }

  return { exports, reExports };
}

function collectWorkflowBindings(sourceFile: ts.SourceFile): {
  readonly names: Set<string>;
  readonly namespaces: Set<string>;
} {
  const names = new Set(["Workflow"]);
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      moduleSpecifierText(statement.moduleSpecifier) !== "sideffect"
    ) {
      continue;
    }

    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings) {
      continue;
    }

    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }

    for (const element of namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "Workflow") {
        names.add(element.name.text);
      }
    }
  }

  return { names, namespaces };
}

function workflowNameFromLayerExpression(
  expression: ts.Expression,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
  workflowDefinitions: Map<string, string>,
): string | undefined {
  const call = skipOuterExpressions(expression);
  if (!ts.isCallExpression(call)) {
    return;
  }

  const callee = skipOuterExpressions(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "toLayer") {
    return;
  }

  const receiver = skipOuterExpressions(callee.expression);
  if (ts.isIdentifier(receiver)) {
    return workflowDefinitions.get(receiver.text);
  }

  return workflowNameFromMakeCall(receiver, workflowBindings);
}

function workflowNameFromMakeCall(
  expression: ts.Expression,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
): string | undefined {
  const call = skipOuterExpressions(expression);
  if (!ts.isCallExpression(call) || !isWorkflowMakeCallee(call.expression, workflowBindings)) {
    return;
  }

  const options = call.arguments[0];
  if (!options) {
    return;
  }

  const object = skipOuterExpressions(options);
  if (!ts.isObjectLiteralExpression(object)) {
    return;
  }

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !propertyNameEquals(property.name, "name")) {
      continue;
    }

    return staticStringValue(property.initializer);
  }
}

function isWorkflowMakeCallee(
  expression: ts.Expression,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
): boolean {
  const callee = skipOuterExpressions(expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "make") {
    return false;
  }

  const receiver = skipOuterExpressions(callee.expression);
  if (ts.isIdentifier(receiver)) {
    return workflowBindings.names.has(receiver.text);
  }

  return (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.name.text === "Workflow" &&
    ts.isIdentifier(receiver.expression) &&
    workflowBindings.namespaces.has(receiver.expression.text)
  );
}

function exportSpecifierNames(
  declaration: ts.ExportDeclaration,
  exports: ts.NamedExports,
): Array<{ readonly imported: string; readonly exported: string }> {
  if (declaration.isTypeOnly) {
    return [];
  }

  return exports.elements.flatMap((element) => {
    if (element.isTypeOnly) {
      return [];
    }

    const imported = moduleExportNameText(element.propertyName ?? element.name);
    const exported = moduleExportNameText(element.name);
    return imported && exported ? [{ imported, exported }] : [];
  });
}

function discoveredWorkflow(
  workflowName: string,
  filePath: string,
  exportName: string,
): DiscoveredWorkflowExport {
  return { workflowName, modulePath: filePath, exportName };
}

function hasExportModifier(node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function moduleSpecifierText(moduleSpecifier: ts.Expression | undefined): string | undefined {
  return moduleSpecifier && ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;
}

function moduleExportNameText(name: ts.ModuleExportName): string | undefined {
  return ts.isIdentifier(name) && isIdentifierName(name.text) ? name.text : undefined;
}

function propertyNameEquals(name: ts.PropertyName, expected: string): boolean {
  return (
    (ts.isIdentifier(name) && name.text === expected) ||
    (ts.isStringLiteral(name) && name.text === expected)
  );
}

function staticStringValue(expression: ts.Expression): string | undefined {
  const value = skipOuterExpressions(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
}

function skipOuterExpressions(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function scriptKindForFile(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".ts":
    case ".mts":
    case ".cts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.Unknown;
  }
}

function capturedWorkflow(
  workflowName: string,
  filePath: string,
  exportName: string,
): CapturedSideffectWorkflow {
  const className = classNameFromWorkflowName(workflowName);
  return {
    kind: "sideffect",
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

function dedupeCapturedWorkflows<const Entry extends CapturedWorkflow>(
  entries: Array<Entry>,
): Array<Entry> {
  const byClassName = new Map<string, Entry>();
  for (const entry of entries) {
    byClassName.set(entry.config.class_name, entry);
  }
  return [...byClassName.values()];
}

function isSideffectWorkflow(workflow: CapturedWorkflow): workflow is CapturedSideffectWorkflow {
  return workflow.kind === "sideffect";
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
  const result = typeof config === "function" ? config(workerConfig, ...args) : config;

  return result ? (defu(result, workerConfig) as WorkerConfig) : workerConfig;
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
  discovered: Array<CapturedSideffectWorkflow>,
  workerName: string | undefined,
): Array<CapturedWorkflow> {
  const discoveredByClassName = new Map(
    discovered.map((workflow) => [workflow.config.class_name, workflow]),
  );

  return localWorkflowEntries(entries, workerName).map(
    (entry) => discoveredByClassName.get(entry.class_name) ?? { kind: "native", config: entry },
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
