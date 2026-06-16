import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import ts from "typescript";

import { validateWorkflowExportName } from "../entrypoints.ts";
import type { WorkflowConfigEntry } from "../types.ts";

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
const identifierName = /^[$A-Z_a-z][$\w]*$/;

/** Workflow source paths scanned for static `Workflow.make(...).toLayer(...)` exports. */
export type WorkflowDiscoveryPaths = Array<string>;

/** @internal Import target for a discovered Sideffect workflow layer. */
export interface WorkflowLayerImport {
  /** Module path containing the workflow layer export. */
  readonly modulePath: string;
  /** Named export that contains the workflow layer. */
  readonly exportName: string;
}

/** @internal Workflow binding generated from a discovered Sideffect layer. */
export interface CapturedSideffectWorkflow {
  readonly kind: "sideffect";
  readonly config: WorkflowConfigEntry;
  readonly layer: WorkflowLayerImport;
}

/** @internal Static workflow export discovered by TypeScript AST traversal. */
interface DiscoveredWorkflowExport {
  /** Cloudflare Workflow name from `Workflow.make({ name })`. */
  readonly workflowName: string;
  /** Source module that exports the workflow layer. */
  readonly modulePath: string;
  /** Named export containing the workflow layer. */
  readonly exportName: string;
}

/** @internal Local re-export shape followed by workflow discovery. */
type ReExportDeclaration =
  | {
      readonly kind: "named";
      readonly specifier: string;
      readonly exports: Array<{ readonly imported: string; readonly exported: string }>;
    }
  | { readonly kind: "all"; readonly specifier: string };

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
  const roots = Array.isArray(patterns) ? patterns : [patterns];
  const byClassName = new Map<string, CapturedSideffectWorkflow>();

  for (const pattern of roots) {
    const root = resolve(baseDirectory, pattern.replace(/\*.*$/, ""));
    for (const filePath of sourceFiles(root)) {
      for (const workflow of collectWorkflowExportsFromFile(filePath, new Set()).values()) {
        const className = workflow.workflowName
          .split(/[^A-Z_a-z0-9]+/)
          .filter(Boolean)
          .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
          .join("");
        validateWorkflowExportName(className);

        byClassName.set(className, {
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
          layer: {
            modulePath: workflow.modulePath.replace(/\\/g, "/"),
            exportName: workflow.exportName,
          },
        });
      }
    }
  }

  return [...byClassName.values()];
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
      if (
        entry.isFile() &&
        sourceFileExtensions.has(extname(child)) &&
        !declarationFileExtensions.some((extension) => child.endsWith(extension))
      ) {
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
  visited: Set<string>,
): Map<string, DiscoveredWorkflowExport> {
  if (visited.has(filePath)) {
    return new Map();
  }
  visited.add(filePath);

  const analysis = analyzeWorkflowSourceFile(filePath);
  const exports = new Map(analysis.exports);

  for (const reExport of analysis.reExports) {
    if (!reExport.specifier.startsWith(".") && !reExport.specifier.startsWith("/")) {
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
      const exported =
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false;

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
          exports.set(name, {
            workflowName: layerWorkflowName,
            modulePath: filePath,
            exportName: name,
          });
        }
      }
      continue;
    }

    if (!ts.isExportDeclaration(statement)) {
      continue;
    }

    const specifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
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
        exports.set(exportEntry.exported, {
          workflowName,
          modulePath: filePath,
          exportName: exportEntry.exported,
        });
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
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "sideffect"
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
  if (!ts.isCallExpression(call)) {
    return;
  }

  const callee = skipOuterExpressions(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "make") {
    return;
  }

  const receiver = skipOuterExpressions(callee.expression);
  const isWorkflowMake = ts.isIdentifier(receiver)
    ? workflowBindings.names.has(receiver.text)
    : ts.isPropertyAccessExpression(receiver) &&
      receiver.name.text === "Workflow" &&
      ts.isIdentifier(receiver.expression) &&
      workflowBindings.namespaces.has(receiver.expression.text);
  if (!isWorkflowMake) {
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
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name = property.name;
    if (
      !(
        (ts.isIdentifier(name) && name.text === "name") ||
        (ts.isStringLiteral(name) && name.text === "name")
      )
    ) {
      continue;
    }

    const value = skipOuterExpressions(property.initializer);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return value.text;
    }
  }
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

    const importedName = element.propertyName ?? element.name;
    const exportedName = element.name;
    const imported =
      ts.isIdentifier(importedName) && identifierName.test(importedName.text)
        ? importedName.text
        : undefined;
    const exported =
      ts.isIdentifier(exportedName) && identifierName.test(exportedName.text)
        ? exportedName.text
        : undefined;

    return imported && exported ? [{ imported, exported }] : [];
  });
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
