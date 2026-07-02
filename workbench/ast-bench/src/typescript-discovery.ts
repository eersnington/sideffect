/**
 * Benchmark-only extraction of the TypeScript workflow discovery approach used
 * by Sideffect main before the Oxc migration. It intentionally keeps only the
 * syntax exercised by the shared fixtures and is not production discovery code.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import ts from "typescript";

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

interface WorkflowExport {
  readonly exportName: string;
  readonly modulePath: string;
  readonly workflowName: string;
}

interface CapturedWorkflow {
  readonly config: {
    readonly binding: string;
    readonly class_name: string;
    readonly name: string;
  };
  readonly layer: {
    readonly exportName: string;
    readonly modulePath: string;
  };
}

/** Parses one source file using the options from the former TypeScript implementation. */
export function parseTypeScriptSourceText(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false, scriptKind(filePath));
}

/** Runs the former TypeScript AST discovery shape over a workflow directory. */
export function collectWorkflowEntriesWithTypeScript(
  pattern: string,
  baseDirectory: string,
): ReadonlyArray<CapturedWorkflow> {
  const entries = new Map<string, CapturedWorkflow>();
  const root = resolve(baseDirectory, pattern.replace(/\*.*$/, ""));
  for (const filePath of sourceFiles(root)) {
    for (const workflow of collectExports(filePath, new Set()).values()) {
      const className = workflow.workflowName
        .split(/[^A-Z_a-z0-9]+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join("");
      entries.set(className, {
        config: {
          binding: workflow.workflowName
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
            .replace(/[^A-Z_a-z0-9]+/g, "_")
            .toUpperCase(),
          class_name: className,
          name: workflow.workflowName,
        },
        layer: {
          exportName: workflow.exportName,
          modulePath: workflow.modulePath.replace(/\\/g, "/"),
        },
      });
    }
  }
  return [...entries.values()];
}

function collectExports(filePath: string, visited: Set<string>): Map<string, WorkflowExport> {
  if (visited.has(filePath)) return new Map();
  visited.add(filePath);

  const sourceFile = parseTypeScriptSourceText(filePath, readFileSync(filePath, "utf8"));
  const workflowBindings = collectWorkflowBindings(sourceFile);
  const definitions = new Map<string, string>();
  const layers = new Map<string, string>();
  const exports = new Map<string, WorkflowExport>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const exported =
        statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const name = declaration.name.text;
        const workflowName = workflowNameFromMake(declaration.initializer, workflowBindings);
        if (workflowName) {
          definitions.set(name, workflowName);
          continue;
        }
        const layerName = workflowNameFromLayer(
          declaration.initializer,
          workflowBindings,
          definitions,
        );
        if (!layerName) continue;
        layers.set(name, layerName);
        if (exported)
          exports.set(name, { exportName: name, modulePath: filePath, workflowName: layerName });
      }
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = unwrap(statement.expression);
      const workflowName =
        workflowNameFromLayer(expression, workflowBindings, definitions) ??
        (ts.isIdentifier(expression) ? layers.get(expression.text) : undefined);
      if (workflowName)
        exports.set("default", { exportName: "default", modulePath: filePath, workflowName });
      continue;
    }

    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isLocal(statement.moduleSpecifier.text)
    )
      continue;
    const target = resolveSourceFile(dirname(filePath), statement.moduleSpecifier.text);
    if (!target) continue;
    const targetExports = collectExports(target, visited);
    if (!statement.exportClause) {
      for (const [name, workflow] of targetExports)
        if (name !== "default") exports.set(name, workflow);
    } else if (ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const imported = element.propertyName?.text ?? element.name.text;
        const workflow = targetExports.get(imported);
        if (workflow) exports.set(element.name.text, workflow);
      }
    }
  }
  return exports;
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
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "sideffect"
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "Workflow")
          names.add(element.name.text);
      }
  }
  return { names, namespaces };
}

function workflowNameFromLayer(
  expression: ts.Expression,
  bindings: ReturnType<typeof collectWorkflowBindings>,
  definitions: ReadonlyMap<string, string>,
): string | undefined {
  const call = unwrap(expression);
  if (!ts.isCallExpression(call)) return;
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "toLayer") return;
  const receiver = unwrap(callee.expression);
  return ts.isIdentifier(receiver)
    ? definitions.get(receiver.text)
    : workflowNameFromMake(receiver, bindings);
}

function workflowNameFromMake(
  expression: ts.Expression,
  bindings: ReturnType<typeof collectWorkflowBindings>,
): string | undefined {
  const call = unwrap(expression);
  if (!ts.isCallExpression(call)) return;
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "make") return;
  const receiver = unwrap(callee.expression);
  const matches = ts.isIdentifier(receiver)
    ? bindings.names.has(receiver.text)
    : ts.isPropertyAccessExpression(receiver) &&
      receiver.name.text === "Workflow" &&
      ts.isIdentifier(receiver.expression) &&
      bindings.namespaces.has(receiver.expression.text);
  if (!matches) return;
  const options = call.arguments[0] && unwrap(call.arguments[0]);
  if (!options || !ts.isObjectLiteralExpression(options)) return;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    if (!((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === "name")) continue;
    const value = unwrap(property.initializer);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  }
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}

function sourceFiles(path: string): ReadonlyArray<string> {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return [];
  if (stats.isFile()) return isSourceFile(path) ? [path] : [];
  if (!stats.isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory()
        ? sourceFiles(child)
        : entry.isFile() && isSourceFile(child)
          ? [child]
          : [];
    });
}

function isSourceFile(path: string): boolean {
  return (
    sourceExtensions.has(extname(path)) &&
    !path.endsWith(".d.ts") &&
    !path.endsWith(".d.mts") &&
    !path.endsWith(".d.cts")
  );
}

function resolveSourceFile(baseDirectory: string, specifier: string): string | undefined {
  const base = resolve(baseDirectory, specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, "index.ts")];
  return candidates.find(existsSync);
}

function isLocal(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}
