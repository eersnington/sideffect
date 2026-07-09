/**
 * Owns workflow-discovery parsing through Oxc.
 *
 * This module selects raw-transfer mode once, hides Oxc parser options behind a
 * narrow parse capability, and keeps read/parse failures typed for discovery.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname } from "node:path";

import { Effect, Schema } from "effect";
import type {
  EcmaScriptModule,
  Expression,
  ExportDefaultDeclarationKind,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  MemberExpression,
  ObjectProperty,
  ParserOptions,
  Program,
  Statement,
  VariableDeclaration,
} from "oxc-parser";

import type { WorkflowLayerImport } from "./workflow-discovery.ts";

const require = createRequire(import.meta.url);
const identifierName = /^[$A-Z_a-z][$\w]*$/;

interface OxcParserModule {
  readonly parseSync: (
    filePath: string,
    source: string,
    options: OxcParserOptions,
  ) => WorkflowParserResult;
  readonly rawTransferSupported: () => boolean;
}

type OxcParserOptions = ParserOptions & {
  readonly experimentalRawTransfer?: boolean;
};

/** @internal Oxc output consumed by workflow discovery. */
export interface WorkflowParserResult {
  readonly program: Program;
  readonly module: EcmaScriptModule;
  readonly errors: ReadonlyArray<{ readonly message: string }>;
}

/** @internal Selected Oxc parser mode for one workflow discovery run. */
export type WorkflowDiscoveryParserSelection = "raw-transfer" | "standard";

/** @internal Selected parser mode and configured parse capability. */
export interface WorkflowDiscoveryParser {
  readonly selection: WorkflowDiscoveryParserSelection;
  readonly parse: (filePath: string, source: string) => WorkflowParserResult;
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

interface WorkflowBindings {
  readonly names: Set<string>;
  readonly namespaces: Set<string>;
}

interface WorkflowSourceAnalysis {
  readonly filePath: string;
  readonly bindings: WorkflowBindings;
  readonly definitions: Map<string, string>;
  readonly layers: Map<string, string>;
  readonly exports: Map<string, DiscoveredWorkflowExport>;
  readonly definitionExports: Map<string, string>;
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
  const selection = parser.rawTransferSupported() ? "raw-transfer" : "standard";
  return {
    selection,
    parse: (filePath, source) =>
      parser.parseSync(filePath, source, parseOptions(selection, filePath)),
  };
}

function loadOxcParser(): Effect.Effect<OxcParserModule, WorkflowParserUnavailable> {
  if (loadedOxcParser) {
    return Effect.succeed(loadedOxcParser);
  }

  return Effect.try({
    try: () => {
      // SAFETY: oxc-parser is an exact runtime dependency. This assertion is
      // isolated at the CommonJS boundary; callers receive a narrow capability.
      const parser = require("oxc-parser") as OxcParserModule;
      loadedOxcParser = parser;
      return parser;
    },
    catch: (cause) => new WorkflowParserUnavailable({ cause }),
  });
}

interface ParseWorkflowSourceFileInput {
  readonly parser: WorkflowDiscoveryParser;
  readonly filePath: string;
  readonly importedDefinitions: ReadonlyMap<string, string>;
}

/** @internal Reads, parses, and analyzes one workflow source file with Oxc. */
export const parseWorkflowSourceFile = Effect.fnUntraced(function* (
  input: ParseWorkflowSourceFileInput,
): Effect.fn.Return<ParsedWorkflowSourceFile, WorkflowParserFailure> {
  const source = yield* Effect.try({
    try: () => readFileSync(input.filePath, "utf8"),
    catch: (cause) => new WorkflowSourceReadFailed({ filePath: input.filePath, cause }),
  });
  const result = yield* Effect.try({
    try: () => input.parser.parse(input.filePath, source),
    catch: (cause) => new WorkflowParserInvocationFailed({ filePath: input.filePath, cause }),
  });

  if (result.errors.length > 0) {
    return yield* new WorkflowSourceParseFailed({
      filePath: input.filePath,
      message: result.errors[0]?.message ?? "unknown parser error",
    });
  }

  return analyzeWorkflowSourceFile(
    input.filePath,
    result.program,
    result.module,
    input.importedDefinitions,
  );
});

/** @internal Formats parser mode selection for Vite logs. */
export function formatParserSelection(selection: WorkflowDiscoveryParserSelection): string {
  switch (selection) {
    case "raw-transfer":
      return "oxc raw-transfer";
    case "standard":
      return "oxc standard (raw transfer unavailable)";
  }
}

function parseOptions(
  selection: WorkflowDiscoveryParserSelection,
  filePath: string,
): OxcParserOptions {
  return {
    astType: "ts",
    lang: oxcLangForFile(filePath),
    preserveParens: false,
    range: false,
    showSemanticErrors: false,
    sourceType: "module",
    ...(selection === "raw-transfer" ? { experimentalRawTransfer: true } : {}),
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
  const analysis: WorkflowSourceAnalysis = {
    filePath,
    bindings: workflowBindings,
    definitions: workflowDefinitions,
    layers: workflowLayers,
    exports,
    definitionExports,
  };

  for (const statement of program.body) {
    collectStatement(statement, analysis);
  }

  collectLocalExportSpecifiers(module, analysis);

  return {
    filePath,
    imports: collectLocalImports(module),
    reExports: collectReExports(module),
    exports,
    definitionExports,
  };
}

function collectWorkflowBindings(module: EcmaScriptModule): WorkflowBindings {
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
    if (!(specifier.startsWith(".") || specifier.startsWith("/"))) {
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

function collectStatement(statement: Statement, analysis: WorkflowSourceAnalysis): void {
  switch (statement.type) {
    case "VariableDeclaration": {
      collectVariableDeclaration(statement, false, analysis);
      break;
    }
    case "ExportNamedDeclaration": {
      collectExportNamedDeclaration(statement, analysis);
      break;
    }
    case "ExportDefaultDeclaration": {
      collectDefaultExport(statement, analysis);
      break;
    }
  }
}

function collectExportNamedDeclaration(
  statement: ExportNamedDeclaration,
  analysis: WorkflowSourceAnalysis,
): void {
  if (statement.exportKind === "type" || statement.declaration?.type !== "VariableDeclaration") {
    return;
  }

  collectVariableDeclaration(statement.declaration, true, analysis);
}

function collectVariableDeclaration(
  declaration: VariableDeclaration,
  exported: boolean,
  analysis: WorkflowSourceAnalysis,
): void {
  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier" || !declarator.init) {
      continue;
    }

    const name = declarator.id.name;
    const workflowName = workflowNameFromMakeCall(declarator.init, analysis.bindings);
    if (workflowName) {
      analysis.definitions.set(name, workflowName);
      if (exported) {
        analysis.definitionExports.set(name, workflowName);
      }
      continue;
    }

    const layerWorkflowName = workflowNameFromLayerExpression(
      declarator.init,
      analysis.bindings,
      analysis.definitions,
    );
    if (!layerWorkflowName) {
      continue;
    }

    analysis.layers.set(name, layerWorkflowName);
    if (exported) {
      analysis.exports.set(name, {
        workflowName: layerWorkflowName,
        modulePath: analysis.filePath,
        exportKind: "named",
        exportName: name,
      });
    }
  }
}

function collectDefaultExport(
  statement: ExportDefaultDeclaration,
  analysis: WorkflowSourceAnalysis,
): void {
  const declaration = defaultExportExpression(statement.declaration);
  if (!declaration) {
    return;
  }
  const expression = skipOuterExpression(declaration);

  const layerWorkflowName =
    workflowNameFromLayerExpression(expression, analysis.bindings, analysis.definitions) ??
    (expression.type === "Identifier" ? analysis.layers.get(expression.name) : undefined);
  if (layerWorkflowName) {
    analysis.exports.set("default", {
      workflowName: layerWorkflowName,
      modulePath: analysis.filePath,
      exportKind: "default",
      exportName: "default",
    });
    return;
  }

  const workflowName =
    expression.type === "Identifier"
      ? analysis.definitions.get(expression.name)
      : workflowNameFromMakeCall(expression, analysis.bindings);
  if (workflowName) {
    analysis.definitionExports.set("default", workflowName);
  }
}

function defaultExportExpression(
  declaration: ExportDefaultDeclarationKind,
): Expression | undefined {
  switch (declaration.type) {
    case "ClassDeclaration":
    case "FunctionDeclaration":
    case "TSDeclareFunction":
    case "TSInterfaceDeclaration":
      return;
    default:
      return declaration;
  }
}

function collectLocalExportSpecifiers(
  module: EcmaScriptModule,
  analysis: WorkflowSourceAnalysis,
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

      collectExportSpecifier({ imported, exported }, analysis);
    }
  }
}

function collectExportSpecifier(
  specifier: { readonly imported: string; readonly exported: string },
  analysis: WorkflowSourceAnalysis,
): void {
  const workflowName = analysis.layers.get(specifier.imported);
  if (workflowName) {
    analysis.exports.set(
      specifier.exported,
      specifier.exported === "default"
        ? {
            workflowName,
            modulePath: analysis.filePath,
            exportKind: "default",
            exportName: "default",
          }
        : {
            workflowName,
            modulePath: analysis.filePath,
            exportKind: "named",
            exportName: specifier.exported,
          },
    );
  }

  const definitionWorkflowName = analysis.definitions.get(specifier.imported);
  if (definitionWorkflowName) {
    analysis.definitionExports.set(specifier.exported, definitionWorkflowName);
  }
}

function workflowNameFromLayerExpression(
  expression: Expression,
  workflowBindings: WorkflowBindings,
  workflowDefinitions: ReadonlyMap<string, string>,
): string | undefined {
  const call = skipOuterExpression(expression);
  if (call.type !== "CallExpression") {
    return;
  }

  const callee = skipOuterExpression(call.callee);
  if (!isMemberNamed(callee, "toLayer")) {
    return;
  }

  const receiver = skipOuterExpression(callee.object);
  if (receiver.type === "Identifier") {
    return workflowDefinitions.get(receiver.name);
  }

  return workflowNameFromMakeCall(receiver, workflowBindings);
}

function workflowNameFromMakeCall(
  expression: Expression,
  workflowBindings: WorkflowBindings,
): string | undefined {
  const call = skipOuterExpression(expression);
  if (call.type !== "CallExpression") {
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
  if (object.type !== "ObjectExpression") {
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

function isWorkflowReceiver(expression: Expression, workflowBindings: WorkflowBindings): boolean {
  const receiver = skipOuterExpression(expression);
  if (receiver.type === "Identifier") {
    return workflowBindings.names.has(receiver.name);
  }

  return (
    isMemberNamed(receiver, "Workflow") &&
    receiver.object.type === "Identifier" &&
    workflowBindings.namespaces.has(receiver.object.name)
  );
}

function isMemberNamed(expression: Expression, property: string): expression is MemberExpression {
  return expression.type === "MemberExpression" && memberPropertyName(expression) === property;
}

function memberPropertyName(expression: MemberExpression): string | undefined {
  if (!expression.computed && expression.property.type === "Identifier") {
    return expression.property.name;
  }
  if (!expression.computed) {
    return;
  }
  return staticString(skipOuterExpression(expression.property));
}

function propertyKeyName(property: ObjectProperty): string | undefined {
  if (!property.computed && property.key.type === "Identifier") {
    return property.key.name;
  }
  if (property.key.type === "Identifier" || property.key.type === "PrivateIdentifier") {
    return;
  }
  return staticString(skipOuterExpression(property.key));
}

function staticString(expression: Expression): string | undefined {
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }
  if (expression.type !== "TemplateLiteral" || expression.expressions.length > 0) {
    return;
  }

  const quasi = expression.quasis[0];
  return quasi?.value.cooked ?? quasi?.value.raw;
}

function skipOuterExpression(expression: Expression): Expression {
  let current = expression;
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

function isIdentifierName(value: string): boolean {
  return identifierName.test(value);
}
