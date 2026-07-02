/**
 * Owns workflow-discovery parsing through Oxc.
 *
 * This is the only module that selects raw-transfer mode and translates parser
 * load/read/parse failures into typed discovery errors before the Vite boundary.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname } from "node:path";

import { Effect, Schema } from "effect";
import type {
  EcmaScriptModule,
  Expression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  ParserOptions,
  Program,
  Statement,
  VariableDeclaration,
} from "oxc-parser";

import type { WorkflowLayerImport } from "./workflow-discovery.ts";

const require = createRequire(import.meta.url);
const identifierName = /^[$A-Z_a-z][$\w]*$/;

type OxcParserModule = Pick<typeof import("oxc-parser"), "parseSync" | "rawTransferSupported">;
type OxcParserOptions = ParserOptions & {
  readonly experimentalRawTransfer?: boolean;
};

/** @internal Selected Oxc parser mode for one workflow discovery run. */
export type WorkflowDiscoveryParserSelection =
  | { readonly _tag: "RawTransfer" }
  | { readonly _tag: "Standard" };

/** @internal Oxc parser dependency and mode selected for workflow discovery. */
export interface WorkflowDiscoveryParser {
  readonly parser: OxcParserModule;
  readonly selection: WorkflowDiscoveryParserSelection;
}

/** @internal Static workflow export discovered from a parsed source module. */
export type DiscoveredWorkflowExport = WorkflowLayerImport & {
  /** Cloudflare Workflow name from `Workflow.make({ name })`. */
  readonly workflowName: string;
};

/** @internal Local import bindings that may reference exported workflow definitions. */
export interface LocalWorkflowImport {
  readonly specifier: string;
  readonly imports: ReadonlyArray<{ readonly imported: string; readonly local: string }>;
}

/** @internal Local re-export shape followed by workflow discovery. */
export type WorkflowReExport =
  | {
      readonly kind: "named";
      readonly specifier: string;
      readonly exports: ReadonlyArray<{ readonly imported: string; readonly exported: string }>;
    }
  | { readonly kind: "all"; readonly specifier: string };

/** @internal Parsed workflow source facts needed by discovery. */
export interface ParsedWorkflowSourceFile {
  readonly filePath: string;
  readonly imports: ReadonlyArray<LocalWorkflowImport>;
  readonly reExports: ReadonlyArray<WorkflowReExport>;
  readonly exports: ReadonlyMap<string, DiscoveredWorkflowExport>;
  readonly definitionExports: ReadonlyMap<string, string>;
}

/** @internal Expected failure while loading the workflow parser dependency. */
export class WorkflowParserUnavailable extends Schema.TaggedErrorClass<WorkflowParserUnavailable>()(
  "WorkflowParserUnavailable",
  {
    cause: Schema.Defect(),
  },
) {}

/** @internal Expected failure while reading a workflow source file. */
export class WorkflowSourceReadFailed extends Schema.TaggedErrorClass<WorkflowSourceReadFailed>()(
  "WorkflowSourceReadFailed",
  {
    cause: Schema.Defect(),
    filePath: Schema.String,
  },
) {}

/** @internal Expected failure while parsing a workflow source file. */
export class WorkflowSourceParseFailed extends Schema.TaggedErrorClass<WorkflowSourceParseFailed>()(
  "WorkflowSourceParseFailed",
  {
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

/** @internal Expected failure while invoking the workflow parser dependency. */
export class WorkflowParserInvocationFailed extends Schema.TaggedErrorClass<WorkflowParserInvocationFailed>()(
  "WorkflowParserInvocationFailed",
  {
    cause: Schema.Defect(),
    filePath: Schema.String,
  },
) {}

/** @internal Expected workflow parser failures. */
export type WorkflowParserFailure =
  | WorkflowParserUnavailable
  | WorkflowParserInvocationFailed
  | WorkflowSourceReadFailed
  | WorkflowSourceParseFailed;

let loadedOxcParser: OxcParserModule | undefined;

/** @internal Creates the Oxc parser adapter used for one workflow discovery run. */
export const makeWorkflowDiscoveryParser: Effect.Effect<
  WorkflowDiscoveryParser,
  WorkflowParserUnavailable
> = Effect.gen(function* () {
  const parser = yield* loadOxcParser();
  return makeWorkflowDiscoveryParserFromOxc(parser);
});

/** @internal Creates a parser adapter from an explicit parser dependency. */
export function makeWorkflowDiscoveryParserFromOxc(
  parser: OxcParserModule,
): WorkflowDiscoveryParser {
  return {
    parser,
    selection: parser.rawTransferSupported() ? { _tag: "RawTransfer" } : { _tag: "Standard" },
  };
}

/** @internal Reads, parses, and analyzes one workflow source file with Oxc. */
export function parseWorkflowSourceFile(
  workflowParser: WorkflowDiscoveryParser,
  filePath: string,
  importedWorkflowDefinitions: ReadonlyMap<string, string>,
): Effect.Effect<
  ParsedWorkflowSourceFile,
  WorkflowParserInvocationFailed | WorkflowSourceReadFailed | WorkflowSourceParseFailed
> {
  return Effect.gen(function* () {
    const source = yield* Effect.try({
      try: () => readFileSync(filePath, "utf8"),
      catch: (cause) => new WorkflowSourceReadFailed({ filePath, cause }),
    });
    const result = yield* Effect.try({
      try: () =>
        workflowParser.parser.parseSync(filePath, source, parseOptions(workflowParser, filePath)),
      catch: (cause) => new WorkflowParserInvocationFailed({ filePath, cause }),
    });

    if (result.errors.length > 0) {
      return yield* new WorkflowSourceParseFailed({
        filePath,
        message: result.errors[0]?.message ?? "unknown parser error",
      });
    }

    return analyzeWorkflowSourceFile(
      filePath,
      result.program,
      result.module,
      importedWorkflowDefinitions,
    );
  });
}

/** @internal Parses one source string with the selected Oxc parser mode. */
export function parseWorkflowSourceText(
  workflowParser: WorkflowDiscoveryParser,
  filePath: string,
  source: string,
): void {
  const result = workflowParser.parser.parseSync(
    filePath,
    source,
    parseOptions(workflowParser, filePath),
  );
  if (result.errors.length > 0) {
    throw new Error(
      `Oxc failed to parse ${filePath} while benchmarking Sideffect discovery: ${result.errors[0]?.message ?? "unknown parser error"}`,
    );
  }
}

/** @internal Formats parser mode selection for Vite logs. */
export function formatParserSelection(selection: WorkflowDiscoveryParserSelection): string {
  switch (selection._tag) {
    case "RawTransfer":
      return "oxc raw-transfer";
    case "Standard":
      return "oxc standard (raw transfer unavailable)";
  }
}

function loadOxcParser(): Effect.Effect<OxcParserModule, WorkflowParserUnavailable> {
  if (loadedOxcParser) {
    return Effect.succeed(loadedOxcParser);
  }

  return Effect.try({
    try: () => {
      // SAFETY: The following runtime checks prove the parser surface this adapter uses.
      const parser = require("oxc-parser") as Partial<OxcParserModule>;
      if (typeof parser.parseSync !== "function") {
        throw new Error('Resolved "oxc-parser", but it does not expose parseSync.');
      }
      if (typeof parser.rawTransferSupported !== "function") {
        throw new Error('Resolved "oxc-parser", but it does not expose rawTransferSupported.');
      }

      loadedOxcParser = parser as OxcParserModule;
      return loadedOxcParser;
    },
    catch: (cause) => new WorkflowParserUnavailable({ cause }),
  });
}

function parseOptions(workflowParser: WorkflowDiscoveryParser, filePath: string): OxcParserOptions {
  return {
    astType: "ts",
    lang: oxcLangForFile(filePath),
    preserveParens: false,
    range: false,
    showSemanticErrors: false,
    sourceType: "module",
    ...(workflowParser.selection._tag === "RawTransfer" ? { experimentalRawTransfer: true } : {}),
  };
}

function oxcLangForFile(path: string): "js" | "jsx" | "ts" | "tsx" {
  switch (extname(path)) {
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "js";
    default:
      return "ts";
  }
}

function analyzeWorkflowSourceFile(
  filePath: string,
  program: Program,
  module: EcmaScriptModule,
  importedWorkflowDefinitions: ReadonlyMap<string, string>,
): ParsedWorkflowSourceFile {
  const workflowBindings = collectWorkflowBindings(module);
  const workflowDefinitions = new Map(importedWorkflowDefinitions);
  const workflowLayers = new Map<string, string>();
  const exports = new Map<string, DiscoveredWorkflowExport>();
  const definitionExports = new Map<string, string>();

  for (const statement of program.body) {
    collectStatement(
      filePath,
      statement,
      workflowBindings,
      workflowDefinitions,
      workflowLayers,
      exports,
      definitionExports,
    );
  }

  collectLocalExportSpecifiers(
    filePath,
    module,
    workflowDefinitions,
    workflowLayers,
    exports,
    definitionExports,
  );

  return {
    filePath,
    imports: collectLocalImports(module),
    reExports: collectReExports(module),
    exports,
    definitionExports,
  };
}

function collectWorkflowBindings(module: EcmaScriptModule): {
  readonly names: Set<string>;
  readonly namespaces: Set<string>;
} {
  const names = new Set<string>();
  const namespaces = new Set<string>();

  for (const importDeclaration of module.staticImports) {
    if (importDeclaration.moduleRequest.value !== "sideffect") {
      continue;
    }

    for (const entry of importDeclaration.entries) {
      if (entry.isType) {
        continue;
      }
      if (entry.importName.kind === "NamespaceObject") {
        namespaces.add(entry.localName.value);
        continue;
      }
      if (entry.importName.kind === "Name" && entry.importName.name === "Workflow") {
        names.add(entry.localName.value);
      }
    }
  }

  return { names, namespaces };
}

function collectLocalImports(module: EcmaScriptModule): ReadonlyArray<LocalWorkflowImport> {
  const declarations: Array<LocalWorkflowImport> = [];

  for (const importDeclaration of module.staticImports) {
    const specifier = importDeclaration.moduleRequest.value;
    if (!isLocalSpecifier(specifier)) {
      continue;
    }

    const imports = importDeclaration.entries.flatMap((entry) => {
      if (entry.isType) {
        return [];
      }

      const imported =
        entry.importName.kind === "Default"
          ? "default"
          : entry.importName.kind === "Name"
            ? entry.importName.name
            : undefined;
      const local = entry.localName.value;
      return imported && isIdentifierName(imported) && isIdentifierName(local)
        ? [{ imported, local }]
        : [];
    });

    if (imports.length > 0) {
      declarations.push({ specifier, imports });
    }
  }

  return declarations;
}

function collectReExports(module: EcmaScriptModule): ReadonlyArray<WorkflowReExport> {
  const bySpecifier = new Map<
    string,
    Array<{ readonly imported: string; readonly exported: string }>
  >();
  const starExports = new Set<string>();

  for (const exportDeclaration of module.staticExports) {
    for (const entry of exportDeclaration.entries) {
      if (entry.isType || !entry.moduleRequest) {
        continue;
      }

      const specifier = entry.moduleRequest.value;
      if (entry.importName.kind === "AllButDefault") {
        starExports.add(specifier);
        continue;
      }

      if (entry.importName.kind !== "Name" || entry.exportName.kind !== "Name") {
        continue;
      }

      const imported = entry.importName.name;
      const exported = entry.exportName.name;
      if (!imported || !exported || !isIdentifierName(imported) || !isIdentifierName(exported)) {
        continue;
      }

      const exports = bySpecifier.get(specifier) ?? [];
      exports.push({ imported, exported });
      bySpecifier.set(specifier, exports);
    }
  }

  return [
    ...[...starExports].map((specifier): WorkflowReExport => ({ kind: "all", specifier })),
    ...[...bySpecifier].map(
      ([specifier, exports]): WorkflowReExport => ({ kind: "named", specifier, exports }),
    ),
  ];
}

function collectStatement(
  filePath: string,
  statement: Statement | ImportDeclaration,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
  workflowDefinitions: Map<string, string>,
  workflowLayers: Map<string, string>,
  exports: Map<string, DiscoveredWorkflowExport>,
  definitionExports: Map<string, string>,
): void {
  switch (statement.type) {
    case "VariableDeclaration": {
      collectVariableDeclaration(
        filePath,
        statement,
        false,
        workflowBindings,
        workflowDefinitions,
        workflowLayers,
        exports,
        definitionExports,
      );
      break;
    }
    case "ExportNamedDeclaration": {
      collectExportNamedDeclaration(
        filePath,
        statement,
        workflowBindings,
        workflowDefinitions,
        workflowLayers,
        exports,
        definitionExports,
      );
      break;
    }
    case "ExportDefaultDeclaration": {
      collectDefaultExport(
        filePath,
        statement,
        workflowBindings,
        workflowDefinitions,
        workflowLayers,
        exports,
        definitionExports,
      );
      break;
    }
  }
}

function collectExportNamedDeclaration(
  filePath: string,
  statement: ExportNamedDeclaration,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
  workflowDefinitions: Map<string, string>,
  workflowLayers: Map<string, string>,
  exports: Map<string, DiscoveredWorkflowExport>,
  definitionExports: Map<string, string>,
): void {
  if (statement.exportKind === "type" || statement.declaration?.type !== "VariableDeclaration") {
    return;
  }

  collectVariableDeclaration(
    filePath,
    statement.declaration,
    true,
    workflowBindings,
    workflowDefinitions,
    workflowLayers,
    exports,
    definitionExports,
  );
}

function collectVariableDeclaration(
  filePath: string,
  declaration: VariableDeclaration,
  exported: boolean,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
  workflowDefinitions: Map<string, string>,
  workflowLayers: Map<string, string>,
  exports: Map<string, DiscoveredWorkflowExport>,
  definitionExports: Map<string, string>,
): void {
  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier" || !declarator.init) {
      continue;
    }

    const name = declarator.id.name;
    const workflowName = workflowNameFromMakeCall(declarator.init, workflowBindings);
    if (workflowName) {
      workflowDefinitions.set(name, workflowName);
      if (exported) {
        definitionExports.set(name, workflowName);
      }
      continue;
    }

    const layerWorkflowName = workflowNameFromLayerExpression(
      declarator.init,
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
        exportKind: "named",
        exportName: name,
      });
    }
  }
}

function collectDefaultExport(
  filePath: string,
  statement: ExportDefaultDeclaration,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
  workflowDefinitions: Map<string, string>,
  workflowLayers: Map<string, string>,
  exports: Map<string, DiscoveredWorkflowExport>,
  definitionExports: Map<string, string>,
): void {
  const expression = skipOuterExpression(statement.declaration);
  if (!expression) {
    return;
  }

  const layerWorkflowName =
    workflowNameFromLayerExpression(expression, workflowBindings, workflowDefinitions) ??
    (expression.type === "Identifier" ? workflowLayers.get(expression.name) : undefined);
  if (layerWorkflowName) {
    exports.set("default", {
      workflowName: layerWorkflowName,
      modulePath: filePath,
      exportKind: "default",
      exportName: "default",
    });
    return;
  }

  const workflowName =
    expression.type === "Identifier"
      ? workflowDefinitions.get(expression.name)
      : workflowNameFromMakeCall(expression, workflowBindings);
  if (workflowName) {
    definitionExports.set("default", workflowName);
  }
}

function collectLocalExportSpecifiers(
  filePath: string,
  module: EcmaScriptModule,
  workflowDefinitions: Map<string, string>,
  workflowLayers: Map<string, string>,
  exports: Map<string, DiscoveredWorkflowExport>,
  definitionExports: Map<string, string>,
): void {
  for (const exportDeclaration of module.staticExports) {
    for (const entry of exportDeclaration.entries) {
      if (entry.isType || entry.moduleRequest || entry.localName.kind !== "Name") {
        continue;
      }
      if (entry.exportName.kind !== "Name" && entry.exportName.kind !== "Default") {
        continue;
      }

      const imported = entry.localName.name;
      const exported = entry.exportName.kind === "Default" ? "default" : entry.exportName.name;
      if (!imported || !exported || !isIdentifierName(imported) || !isIdentifierName(exported)) {
        continue;
      }

      collectExportSpecifier(
        filePath,
        { imported, exported },
        workflowDefinitions,
        workflowLayers,
        exports,
        definitionExports,
      );
    }
  }
}

function collectExportSpecifier(
  filePath: string,
  specifier: { readonly imported: string; readonly exported: string },
  workflowDefinitions: Map<string, string>,
  workflowLayers: Map<string, string>,
  exports: Map<string, DiscoveredWorkflowExport>,
  definitionExports: Map<string, string>,
): void {
  const workflowName = workflowLayers.get(specifier.imported);
  if (workflowName) {
    exports.set(
      specifier.exported,
      specifier.exported === "default"
        ? { workflowName, modulePath: filePath, exportKind: "default", exportName: "default" }
        : {
            workflowName,
            modulePath: filePath,
            exportKind: "named",
            exportName: specifier.exported,
          },
    );
  }

  const definitionWorkflowName = workflowDefinitions.get(specifier.imported);
  if (definitionWorkflowName) {
    definitionExports.set(specifier.exported, definitionWorkflowName);
  }
}

function workflowNameFromLayerExpression(
  expression: Expression,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
  workflowDefinitions: ReadonlyMap<string, string>,
): string | undefined {
  const call = skipOuterExpression(expression);
  if (call?.type !== "CallExpression") {
    return;
  }

  const callee = skipOuterExpression(call.callee);
  if (!isMemberNamed(callee, "toLayer")) {
    return;
  }

  const receiver = skipOuterExpression(callee.object);
  if (!receiver) {
    return;
  }
  if (receiver.type === "Identifier") {
    return workflowDefinitions.get(receiver.name);
  }

  return workflowNameFromMakeCall(receiver, workflowBindings);
}

function workflowNameFromMakeCall(
  expression: Expression,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
): string | undefined {
  const call = skipOuterExpression(expression);
  if (call?.type !== "CallExpression") {
    return;
  }

  const callee = skipOuterExpression(call.callee);
  if (!isMemberNamed(callee, "make")) {
    return;
  }

  if (!isWorkflowReceiver(callee.object, workflowBindings)) {
    return;
  }

  const options = call.arguments[0];
  if (!options || options.type === "SpreadElement") {
    return;
  }

  const object = skipOuterExpression(options);
  if (object?.type !== "ObjectExpression") {
    return;
  }

  // Object properties run in source order. Unknown overrides clear an earlier
  // name until a later static `name` property establishes the final value.
  let workflowName: string | undefined;
  for (const property of object.properties) {
    if (property.type === "SpreadElement") {
      workflowName = undefined;
      continue;
    }

    const propertyName = propertyKeyName(property);
    if (property.computed && propertyName === undefined) {
      workflowName = undefined;
      continue;
    }
    if (propertyName === "name") {
      workflowName = staticString(skipOuterExpression(property.value));
    }
  }

  return workflowName;
}

function isWorkflowReceiver(
  expression: Expression,
  workflowBindings: { readonly names: Set<string>; readonly namespaces: Set<string> },
): boolean {
  const receiver = skipOuterExpression(expression);
  if (!receiver) {
    return false;
  }
  if (receiver.type === "Identifier") {
    return workflowBindings.names.has(receiver.name);
  }

  return (
    isMemberNamed(receiver, "Workflow") &&
    receiver.object.type === "Identifier" &&
    workflowBindings.namespaces.has(receiver.object.name)
  );
}

function isMemberNamed(
  expression: Expression | undefined,
  property: string,
): expression is Extract<Expression, { readonly type: "MemberExpression" }> {
  return expression?.type === "MemberExpression" && memberPropertyName(expression) === property;
}

function memberPropertyName(
  expression: Extract<Expression, { readonly type: "MemberExpression" }>,
): string | undefined {
  if (expression.property.type === "Identifier") {
    return expression.property.name;
  }
  return expression.computed ? staticString(skipOuterExpression(expression.property)) : undefined;
}

function propertyKeyName(
  property: Extract<Expression, { readonly type: "ObjectExpression" }>["properties"][number],
): string | undefined {
  if (property.type !== "Property") {
    return;
  }
  if (!property.computed && property.key.type === "Identifier") {
    return property.key.name;
  }
  return staticString(skipOuterExpression(property.key));
}

function staticString(expression: Expression | undefined): string | undefined {
  if (expression?.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }
  if (expression?.type !== "TemplateLiteral" || expression.expressions.length > 0) {
    return;
  }

  const quasi = expression.quasis[0];
  return quasi?.value.cooked ?? quasi?.value.raw;
}

function skipOuterExpression(value: unknown): Expression | undefined {
  if (!isExpression(value)) {
    return;
  }

  let current: Expression = value;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "ChainExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function isExpression(value: unknown): value is Expression {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === "string"
  );
}

function isIdentifierName(value: string): boolean {
  return identifierName.test(value);
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}
