/**
 * Orchestrates one workflow-discovery run over local source modules.
 *
 * Per-run caches retain only complete traversal results, while branch-local
 * ancestor sets cut cycles. Expected parser and I/O failures stay typed until
 * this module renders them at the synchronous public/Vite boundary.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import { Effect, Schema } from "effect";

import { validateWorkflowExportName } from "../entrypoints.ts";
import type { WorkflowConfigEntry } from "../types.ts";
import {
  type DiscoveredWorkflowExport,
  makeWorkflowDiscoveryParser,
  parseWorkflowSourceFile,
  type ParsedWorkflowSourceFile,
  type WorkflowDiscoveryParserSelection,
  type WorkflowDiscoveryParser,
  type WorkflowParserFailure,
} from "./workflow-discovery-parser.ts";

const sourceFileExtensionOrder = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;
const sourceFileExtensions = new Set<string>(sourceFileExtensionOrder);
const declarationFileExtensions = [".d.ts", ".d.mts", ".d.cts"];

/** Workflow source paths scanned for static `Workflow.make(...).toLayer(...)` exports. */
export type WorkflowDiscoveryPaths = Array<string>;

/** @internal Import target for a discovered Sideffect workflow layer. */
export type WorkflowLayerImport =
  | {
      /** Module path containing the workflow layer export. */
      readonly modulePath: string;
      /** Export form that contains the workflow layer. */
      readonly exportKind: "named";
      /** Named export that contains the workflow layer. */
      readonly exportName: string;
    }
  | {
      /** Module path containing the workflow layer export. */
      readonly modulePath: string;
      /** Export form that contains the workflow layer. */
      readonly exportKind: "default";
      /** Default export that contains the workflow layer. */
      readonly exportName: "default";
    };

/** @internal Workflow binding generated from a discovered Sideffect layer. */
export interface CapturedSideffectWorkflow {
  readonly kind: "sideffect";
  readonly config: WorkflowConfigEntry;
  readonly layer: WorkflowLayerImport;
}

/** @internal Optional diagnostics used by Vite integration. */
export interface WorkflowDiscoveryDiagnostics {
  readonly onParserSelected?: (selection: WorkflowDiscoveryParserSelection) => void;
}

interface CollectWorkflowEntriesInput {
  readonly patterns: WorkflowDiscoveryPaths | string;
  readonly baseDirectory: string;
  readonly diagnostics?: WorkflowDiscoveryDiagnostics;
  readonly parser?: WorkflowDiscoveryParser;
}

interface WorkflowTraversal {
  readonly parser: WorkflowDiscoveryParser;
  readonly parsedSources: Map<string, ParsedWorkflowSourceFile>;
  readonly workflowExports: Map<string, ReadonlyMap<string, DiscoveredWorkflowExport>>;
  readonly workflowDefinitionExports: Map<string, ReadonlyMap<string, string>>;
}

interface WorkflowTraversalResult<Value> {
  readonly values: ReadonlyMap<string, Value>;
  /** An ancestor edge was omitted, so this path-dependent result must not be cached. */
  readonly cycleCut: boolean;
}

/** @internal Expected failure while resolving a local workflow re-export. */
export class WorkflowReExportResolveFailed extends Schema.TaggedErrorClass<WorkflowReExportResolveFailed>()(
  "WorkflowReExportResolveFailed",
  {
    filePath: Schema.String,
    specifier: Schema.String,
  },
) {}

/** @internal Expected workflow discovery failures. */
export type WorkflowDiscoveryFailure = WorkflowParserFailure | WorkflowReExportResolveFailed;

/**
 * Discovers static Sideffect workflow layer exports under the configured paths.
 *
 * The collector follows local barrel re-exports and recognizes static
 * `Workflow.make({ name }).toLayer(...)` forms. Dynamic workflow names and
 * arbitrary runtime value tracing are intentionally left to explicit config.
 */
export function collectWorkflowEntries(
  patterns: WorkflowDiscoveryPaths | string = ["src/workflows"],
  baseDirectory: string = process.cwd(),
): Array<CapturedSideffectWorkflow> {
  return runWorkflowDiscovery({ patterns, baseDirectory });
}

/** @internal Vite-facing discovery API with parser-selection diagnostics. */
export function collectWorkflowEntriesForVite(
  patterns: WorkflowDiscoveryPaths | string = ["src/workflows"],
  baseDirectory: string = process.cwd(),
  diagnostics: WorkflowDiscoveryDiagnostics = {},
): Array<CapturedSideffectWorkflow> {
  return runWorkflowDiscovery({ patterns, baseDirectory, diagnostics });
}

/** @internal Discovers workflow entries with an explicit parser adapter. */
export function collectWorkflowEntriesWithParser(
  patterns: WorkflowDiscoveryPaths | string,
  baseDirectory: string,
  parser: WorkflowDiscoveryParser,
): Array<CapturedSideffectWorkflow> {
  return runWorkflowDiscovery({ patterns, baseDirectory, parser });
}

function runWorkflowDiscovery(
  input: CollectWorkflowEntriesInput,
): Array<CapturedSideffectWorkflow> {
  const result = Effect.runSync(
    collectWorkflowEntriesEffect(input).pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "Failure", error }) as const,
        onSuccess: (workflows) => ({ _tag: "Success", workflows }) as const,
      }),
    ),
  );

  if (result._tag === "Failure") {
    throw renderWorkflowDiscoveryError(result.error);
  }

  return result.workflows;
}

const collectWorkflowEntriesEffect = Effect.fnUntraced(function* (
  input: CollectWorkflowEntriesInput,
): Effect.fn.Return<Array<CapturedSideffectWorkflow>, WorkflowDiscoveryFailure> {
  const files = workflowSourceFiles(input.patterns, input.baseDirectory);
  if (files.length === 0) {
    return [];
  }

  const parser = input.parser ?? (yield* makeWorkflowDiscoveryParser);
  input.diagnostics?.onParserSelected?.(parser.selection);
  const traversal: WorkflowTraversal = {
    parser,
    parsedSources: new Map(),
    workflowExports: new Map(),
    workflowDefinitionExports: new Map(),
  };

  const byClassName = new Map<string, CapturedSideffectWorkflow>();
  for (const filePath of files) {
    const result = yield* collectWorkflowExportsFromFile(filePath, new Set(), traversal);
    for (const workflow of result.values.values()) {
      const captured = captureDiscoveredWorkflow(workflow);
      byClassName.set(captured.config.class_name, captured);
    }
  }

  return [...byClassName.values()];
});

function workflowSourceFiles(
  patterns: WorkflowDiscoveryPaths | string,
  baseDirectory: string,
): Array<string> {
  const roots = Array.isArray(patterns) ? patterns : [patterns];
  return roots.flatMap((pattern) => {
    const root = resolve(baseDirectory, pattern.replace(/\*.*$/, ""));
    return sourceFiles(root);
  });
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

function collectWorkflowExportsFromFile(
  filePath: string,
  ancestors: ReadonlySet<string>,
  traversal: WorkflowTraversal,
): Effect.Effect<WorkflowTraversalResult<DiscoveredWorkflowExport>, WorkflowDiscoveryFailure> {
  return Effect.gen(function* () {
    const cached = traversal.workflowExports.get(filePath);
    if (cached) {
      return { values: cached, cycleCut: false };
    }
    if (ancestors.has(filePath)) {
      return { values: new Map<string, DiscoveredWorkflowExport>(), cycleCut: true };
    }
    const nextAncestors = new Set(ancestors).add(filePath);

    const moduleWithLocalDefinitions = yield* parseWorkflowSourceWithoutImportedDefinitions(
      filePath,
      traversal,
    );
    const importedDefinitions = yield* collectImportedWorkflowDefinitions(
      moduleWithLocalDefinitions,
      filePath,
      new Set(),
      traversal,
    );
    const module =
      importedDefinitions.values.size === 0
        ? moduleWithLocalDefinitions
        : yield* parseWorkflowSourceFile({
            parser: traversal.parser,
            filePath,
            importedDefinitions: importedDefinitions.values,
          });
    const exports = new Map(module.exports);
    let cycleCut = importedDefinitions.cycleCut;

    for (const reExport of module.reExports) {
      if (!isLocalSpecifier(reExport.specifier)) {
        continue;
      }

      const resolved = resolveSourceFile(dirname(filePath), reExport.specifier);
      if (!resolved) {
        return yield* new WorkflowReExportResolveFailed({
          filePath,
          specifier: reExport.specifier,
        });
      }

      const targetExports = yield* collectWorkflowExportsFromFile(
        resolved,
        nextAncestors,
        traversal,
      );
      cycleCut ||= targetExports.cycleCut;
      if (reExport.kind === "all") {
        for (const [exportName, workflow] of targetExports.values) {
          if (exportName !== "default") {
            exports.set(exportName, workflow);
          }
        }
        continue;
      }

      for (const exportEntry of reExport.exports) {
        const workflow = targetExports.values.get(exportEntry.imported);
        if (workflow) {
          exports.set(exportEntry.exported, workflow);
        }
      }
    }

    if (!cycleCut) {
      traversal.workflowExports.set(filePath, exports);
    }
    return { values: exports, cycleCut };
  });
}

function collectWorkflowDefinitionExportsFromFile(
  filePath: string,
  ancestors: ReadonlySet<string>,
  traversal: WorkflowTraversal,
): Effect.Effect<WorkflowTraversalResult<string>, WorkflowDiscoveryFailure> {
  return Effect.gen(function* () {
    const cached = traversal.workflowDefinitionExports.get(filePath);
    if (cached) {
      return { values: cached, cycleCut: false };
    }
    if (ancestors.has(filePath)) {
      return { values: new Map<string, string>(), cycleCut: true };
    }
    const nextAncestors = new Set(ancestors).add(filePath);

    const moduleWithLocalDefinitions = yield* parseWorkflowSourceWithoutImportedDefinitions(
      filePath,
      traversal,
    );
    const importedDefinitions = yield* collectImportedWorkflowDefinitions(
      moduleWithLocalDefinitions,
      filePath,
      nextAncestors,
      traversal,
    );
    const module =
      importedDefinitions.values.size === 0
        ? moduleWithLocalDefinitions
        : yield* parseWorkflowSourceFile({
            parser: traversal.parser,
            filePath,
            importedDefinitions: importedDefinitions.values,
          });
    const exports = new Map(module.definitionExports);
    let cycleCut = importedDefinitions.cycleCut;

    for (const reExport of module.reExports) {
      if (!isLocalSpecifier(reExport.specifier)) {
        continue;
      }

      const resolved = resolveSourceFile(dirname(filePath), reExport.specifier);
      if (!resolved) {
        continue;
      }

      const targetExports = yield* collectWorkflowDefinitionExportsFromFile(
        resolved,
        nextAncestors,
        traversal,
      );
      cycleCut ||= targetExports.cycleCut;
      if (reExport.kind === "all") {
        for (const [exportName, workflowName] of targetExports.values) {
          if (exportName !== "default") {
            exports.set(exportName, workflowName);
          }
        }
        continue;
      }

      for (const exportEntry of reExport.exports) {
        const workflowName = targetExports.values.get(exportEntry.imported);
        if (workflowName) {
          exports.set(exportEntry.exported, workflowName);
        }
      }
    }

    if (!cycleCut) {
      traversal.workflowDefinitionExports.set(filePath, exports);
    }
    return { values: exports, cycleCut };
  });
}

function collectImportedWorkflowDefinitions(
  module: ParsedWorkflowSourceFile,
  filePath: string,
  ancestors: ReadonlySet<string>,
  traversal: WorkflowTraversal,
): Effect.Effect<WorkflowTraversalResult<string>, WorkflowDiscoveryFailure> {
  return Effect.gen(function* () {
    const definitions = new Map<string, string>();
    let cycleCut = false;

    for (const importDeclaration of module.imports) {
      const resolved = resolveSourceFile(dirname(filePath), importDeclaration.specifier);
      if (!resolved) {
        continue;
      }

      const targetDefinitions = yield* collectWorkflowDefinitionExportsFromFile(
        resolved,
        ancestors,
        traversal,
      );
      cycleCut ||= targetDefinitions.cycleCut;
      for (const importEntry of importDeclaration.imports) {
        const workflowName = targetDefinitions.values.get(importEntry.imported);
        if (workflowName) {
          definitions.set(importEntry.local, workflowName);
        }
      }
    }

    return { values: definitions, cycleCut };
  });
}

function parseWorkflowSourceWithoutImportedDefinitions(
  filePath: string,
  traversal: WorkflowTraversal,
): Effect.Effect<ParsedWorkflowSourceFile, WorkflowParserFailure> {
  return Effect.gen(function* () {
    const cached = traversal.parsedSources.get(filePath);
    if (cached) {
      return cached;
    }

    const parsed = yield* parseWorkflowSourceFile({
      parser: traversal.parser,
      filePath,
      importedDefinitions: new Map(),
    });
    traversal.parsedSources.set(filePath, parsed);
    return parsed;
  });
}

function captureDiscoveredWorkflow(workflow: DiscoveredWorkflowExport): CapturedSideffectWorkflow {
  const className = workflow.workflowName
    .split(/[^A-Z_a-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  validateWorkflowExportName(className);

  const modulePath = workflow.modulePath.replace(/\\/g, "/");
  return {
    kind: "sideffect",
    config: {
      binding: workflow.workflowName
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
        .replace(/[^A-Z_a-z0-9]+/g, "_")
        .toUpperCase(),
      name: workflow.workflowName,
      class_name: className,
    },
    layer:
      workflow.exportKind === "default"
        ? { modulePath, exportKind: "default", exportName: "default" }
        : { modulePath, exportKind: "named", exportName: workflow.exportName },
  };
}

function renderWorkflowDiscoveryError(error: WorkflowDiscoveryFailure): Error {
  switch (error._tag) {
    case "WorkflowParserUnavailable":
      return new Error(
        "Sideffect could not load oxc-parser for workflow discovery, so workflow config generation cannot continue. No workflow config was written. Reinstall dependencies, clear node_modules and the lockfile if needed, then rerun your package manager install.",
        { cause: error.cause },
      );
    case "WorkflowParserInvocationFailed":
      return new Error(
        `Sideffect could not invoke oxc-parser for workflow source "${error.filePath}" while generating Cloudflare workflow bindings. No workflow config was written. Verify that oxc-parser supports the current runtime, reinstall dependencies, then rerun the build.`,
        { cause: error.cause },
      );
    case "WorkflowSourceReadFailed":
      return new Error(
        `Sideffect could not read workflow source "${error.filePath}" while generating Cloudflare workflow bindings. No workflow config was written. Check that the file is readable, then rerun the build.`,
        { cause: error.cause },
      );
    case "WorkflowSourceParseFailed":
      return new Error(
        `Sideffect could not parse workflow source "${error.filePath}" with oxc-parser while generating Cloudflare workflow bindings. No workflow config was written. Fix the syntax error, then rerun the build. Parser message: ${error.message}`,
      );
    case "WorkflowReExportResolveFailed":
      return new Error(
        `Sideffect could not resolve workflow re-export module "${error.specifier}" from "${error.filePath}" while generating Cloudflare workflow bindings. No workflow config was written. Check the local import path or export the workflow layer directly.`,
      );
  }
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function resolveSourceFile(baseDirectory: string, specifier: string): string | undefined {
  const basePath = resolve(baseDirectory, specifier);
  const extension = extname(basePath);
  const hasExplicitSourceExtension = extension.length > 0 && sourceFileExtensions.has(extension);
  const fileCandidates = hasExplicitSourceExtension
    ? [basePath, ...typeScriptSourceCandidates(basePath, extension)]
    : sourceFileExtensionOrder.map((sourceExtension) => `${basePath}${sourceExtension}`);
  const indexCandidates = hasExplicitSourceExtension
    ? []
    : sourceFileExtensionOrder.map((sourceExtension) => join(basePath, `index${sourceExtension}`));

  return [...fileCandidates, ...indexCandidates].find(isExistingSourceFile);
}

function typeScriptSourceCandidates(basePath: string, extension: string): ReadonlyArray<string> {
  const stem = basePath.slice(0, -extension.length);
  switch (extension) {
    case ".js":
      return [`${stem}.ts`, `${stem}.tsx`];
    case ".jsx":
      return [`${stem}.tsx`];
    case ".mjs":
      return [`${stem}.mts`];
    case ".cjs":
      return [`${stem}.cts`];
    default:
      return [];
  }
}

function isExistingSourceFile(path: string): boolean {
  if (!isSourceFile(path)) {
    return false;
  }
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}
