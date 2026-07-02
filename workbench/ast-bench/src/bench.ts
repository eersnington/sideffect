/**
 * Benchmark entry point for Sideffect workflow discovery.
 *
 * Fixtures are generated as temporary projects, and each case measures either
 * parser-only work or full discovery over the same on-disk corpus. The
 * TypeScript path is a fixture-limited extraction of the former implementation,
 * while the Oxc path is the current production implementation.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { collectWorkflowEntriesWithParser } from "../../../packages/sideffect/src/vite/workflow-discovery.ts";
import {
  collectWorkflowEntriesWithTypeScript,
  parseTypeScriptSourceText,
} from "./typescript-discovery.ts";
import {
  makeWorkflowDiscoveryParserFromOxc,
  parseWorkflowSourceText,
  type WorkflowDiscoveryParser,
} from "../../../packages/sideffect/src/vite/workflow-discovery-parser.ts";

type FixtureName = "many-small-files" | "few-large-files" | "re-export-graph";
type CaseName =
  | "parse-only-typescript"
  | "parse-only-oxc-standard"
  | "parse-only-oxc-raw-transfer"
  | "workflow-discovery-typescript"
  | "workflow-discovery-oxc-standard"
  | "workflow-discovery-oxc-raw-transfer";

interface Options {
  readonly iterations: number;
  readonly warmup: number;
  readonly fixture: FixtureName | "all";
}

interface SourceEntry {
  readonly path: string;
  readonly source: string;
  readonly bytes: number;
  readonly lines: number;
}

interface BenchResult {
  readonly fixture: string;
  readonly caseName: CaseName;
  readonly files: number;
  readonly bytes: number;
  readonly lines: number;
  readonly iterations: number;
  readonly warmup: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly msPerMb: number;
  readonly observations: number;
  readonly rssDeltaMb: number;
  readonly skipped?: string;
}

const fixtureNames: ReadonlyArray<FixtureName> = [
  "many-small-files",
  "few-large-files",
  "re-export-graph",
];
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

const options = parseOptions(process.argv.slice(2));
const root = join(tmpdir(), `sideffect-typescript-ast-bench-${process.pid}`);

try {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const oxc = await import("oxc-parser");
  const fixtures = options.fixture === "all" ? fixtureNames : [options.fixture];
  const results: Array<BenchResult> = [];

  for (const fixture of fixtures) {
    const fixtureRoot = join(root, fixture);
    writeFixture(fixtureRoot, fixture);
    const corpus = sourceFiles(join(fixtureRoot, "src/workflows")).map(sourceEntry);
    const discoveryPattern =
      fixture === "re-export-graph" ? "src/workflows/index.ts" : "src/workflows";
    const standardParser = makeWorkflowDiscoveryParserFromOxc({
      parseSync: oxc.parseSync,
      rawTransferSupported: () => false,
    });
    const rawParser = oxc.rawTransferSupported()
      ? makeWorkflowDiscoveryParserFromOxc({
          parseSync: oxc.parseSync,
          rawTransferSupported: () => true,
        })
      : undefined;

    assertEquivalentDiscovery(discoveryPattern, fixtureRoot, standardParser);
    if (rawParser) assertEquivalentDiscovery(discoveryPattern, fixtureRoot, rawParser);
    results.push(
      await runCase("parse-only-typescript", fixture, corpus, options, () =>
        parseTypeScriptCorpus(corpus),
      ),
    );
    results.push(
      await runCase("parse-only-oxc-standard", fixture, corpus, options, () =>
        parseCorpus(standardParser, corpus),
      ),
    );
    results.push(
      rawParser
        ? await runCase("parse-only-oxc-raw-transfer", fixture, corpus, options, () =>
            parseCorpus(rawParser, corpus),
          )
        : skipped(
            "parse-only-oxc-raw-transfer",
            fixture,
            corpus,
            options,
            "raw transfer unavailable",
          ),
    );
    results.push(
      await runCase("workflow-discovery-typescript", fixture, corpus, options, () =>
        collectWorkflowEntriesWithTypeScript(discoveryPattern, fixtureRoot),
      ),
    );
    results.push(
      await runCase("workflow-discovery-oxc-standard", fixture, corpus, options, () =>
        collectWorkflowEntriesWithParser(discoveryPattern, fixtureRoot, standardParser),
      ),
    );
    results.push(
      rawParser
        ? await runCase("workflow-discovery-oxc-raw-transfer", fixture, corpus, options, () =>
            collectWorkflowEntriesWithParser(discoveryPattern, fixtureRoot, rawParser),
          )
        : skipped(
            "workflow-discovery-oxc-raw-transfer",
            fixture,
            corpus,
            options,
            "raw transfer unavailable",
          ),
    );
  }

  printMarkdown(results);
  console.log("\n```json");
  console.log(JSON.stringify({ options, results }, null, 2));
  console.log("```");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function parseOptions(args: ReadonlyArray<string>): Options {
  let iterations = 50;
  let warmup = 5;
  let fixture: Options["fixture"] = "all";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    switch (arg) {
      case "--iterations":
        iterations = positiveInteger(arg, value);
        index += 1;
        break;
      case "--warmup":
        warmup = nonNegativeInteger(arg, value);
        index += 1;
        break;
      case "--fixture":
        fixture = parseFixture(value);
        index += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument "${arg}". Run with --help for usage.`);
    }
  }

  return { iterations, warmup, fixture };
}

function positiveInteger(name: string, value: string | undefined): number {
  const parsed = Number(requiredValue(name, value));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected ${name} to be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(name: string, value: string | undefined): number {
  const parsed = Number(requiredValue(name, value));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${name} to be a non-negative integer.`);
  }
  return parsed;
}

function requiredValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function parseFixture(value: string | undefined): Options["fixture"] {
  const fixture = requiredValue("--fixture", value);
  if (fixture === "all" || fixtureNames.includes(fixture as FixtureName)) {
    return fixture as Options["fixture"];
  }
  throw new Error(`Expected --fixture to be one of ${["all", ...fixtureNames].join(", ")}.`);
}

function printHelp(): void {
  console.log(`Usage: bun run src/bench.ts [options]

Use \`bun run bench:node -- [options]\` to measure raw transfer when Node supports it.
The TypeScript discovery case is a minimal baseline for these generated fixtures.

Options:
  --iterations <count>   Measured iterations per case. Default: 50.
  --warmup <count>       Warmup iterations per case. Default: 5.
  --fixture <name>       all, many-small-files, few-large-files, or re-export-graph. Default: all.
`);
}

async function runCase(
  caseName: CaseName,
  fixture: FixtureName,
  corpus: ReadonlyArray<SourceEntry>,
  options: Options,
  run: () => unknown,
): Promise<BenchResult> {
  for (let index = 0; index < options.warmup; index += 1) {
    await run();
  }

  let observations = 0;
  const rssBefore = process.memoryUsage().rss;
  const start = performance.now();
  for (let index = 0; index < options.iterations; index += 1) {
    const result = await run();
    observations += Array.isArray(result) ? result.length : 1;
  }
  const totalMs = performance.now() - start;
  const rssDeltaMb = (process.memoryUsage().rss - rssBefore) / 1_000_000;
  const bytes = corpus.reduce((sum, entry) => sum + entry.bytes, 0);
  const lines = corpus.reduce((sum, entry) => sum + entry.lines, 0);
  const processedMb = (bytes * options.iterations) / 1_000_000;

  return {
    fixture,
    caseName,
    files: corpus.length,
    bytes,
    lines,
    iterations: options.iterations,
    warmup: options.warmup,
    totalMs,
    meanMs: totalMs / options.iterations,
    msPerMb: processedMb === 0 ? 0 : totalMs / processedMb,
    observations,
    rssDeltaMb,
  };
}

function skipped(
  caseName: CaseName,
  fixture: FixtureName,
  corpus: ReadonlyArray<SourceEntry>,
  options: Options,
  skipped: string,
): BenchResult {
  const bytes = corpus.reduce((sum, entry) => sum + entry.bytes, 0);
  const lines = corpus.reduce((sum, entry) => sum + entry.lines, 0);
  return {
    fixture,
    caseName,
    files: corpus.length,
    bytes,
    lines,
    iterations: options.iterations,
    warmup: options.warmup,
    totalMs: 0,
    meanMs: 0,
    msPerMb: 0,
    observations: 0,
    rssDeltaMb: 0,
    skipped,
  };
}

function assertEquivalentDiscovery(
  pattern: string,
  fixtureRoot: string,
  parser: WorkflowDiscoveryParser,
): void {
  const typescriptNames = collectWorkflowEntriesWithTypeScript(pattern, fixtureRoot)
    .map(({ config }) => config.name)
    .sort();
  const oxcNames = collectWorkflowEntriesWithParser(pattern, fixtureRoot, parser)
    .map(({ config }) => config.name)
    .sort();
  if (JSON.stringify(typescriptNames) !== JSON.stringify(oxcNames)) {
    throw new Error(
      `Discovery results differ: TypeScript=${typescriptNames.length}, Oxc=${oxcNames.length}`,
    );
  }
}

function parseTypeScriptCorpus(corpus: ReadonlyArray<SourceEntry>): Array<SourceEntry> {
  for (const entry of corpus) {
    parseTypeScriptSourceText(entry.path, entry.source);
  }
  return [...corpus];
}

function parseCorpus(
  parser: WorkflowDiscoveryParser,
  corpus: ReadonlyArray<SourceEntry>,
): Array<SourceEntry> {
  for (const entry of corpus) {
    parseWorkflowSourceText(parser, entry.path, entry.source);
  }
  return [...corpus];
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
      return entry.isFile() && isSourceFile(child) ? [child] : [];
    });
}

function isSourceFile(path: string): boolean {
  return (
    sourceFileExtensions.has(extname(path)) &&
    !declarationFileExtensions.some((extension) => path.endsWith(extension))
  );
}

function sourceEntry(path: string): SourceEntry {
  const source = readFileSync(path, "utf8");
  return {
    path,
    source,
    bytes: Buffer.byteLength(source, "utf8"),
    lines: source.length === 0 ? 0 : source.split("\n").length,
  };
}

function writeFixture(root: string, fixture: FixtureName): void {
  if (existsSync(root)) {
    return;
  }
  mkdirSync(join(root, "src/workflows"), { recursive: true });

  switch (fixture) {
    case "many-small-files":
      for (let index = 0; index < 250; index += 1) {
        writeWorkflowFile(root, `src/workflows/workflow-${index}.ts`, workflowSource(index, 1));
      }
      break;
    case "few-large-files":
      for (let index = 0; index < 5; index += 1) {
        writeWorkflowFile(root, `src/workflows/workflows-${index}.ts`, workflowSource(index, 80));
      }
      break;
    case "re-export-graph":
      writeReExportGraph(root);
      break;
  }
}

function writeWorkflowFile(root: string, path: string, source: string): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, source);
}

function workflowSource(fileIndex: number, workflows: number): string {
  const lines = [
    'import { Schema, Workflow as W } from "sideffect";',
    'import * as Sideffect from "sideffect";',
    "",
  ];
  for (let index = 0; index < workflows; index += 1) {
    const suffix = `${fileIndex}_${index}`;
    lines.push(
      `const workflow${suffix} = W.make({ name: "generated-${fileIndex}-${index}", payload: Schema.String });`,
      `export const layer${suffix} = workflow${suffix}.toLayer(async () => undefined);`,
      `export const directLayer${suffix} = Sideffect.Workflow.make({ name: "direct-${fileIndex}-${index}", payload: Schema.String }).toLayer(async () => undefined);`,
      "",
    );
  }
  return lines.join("\n");
}

function writeReExportGraph(root: string): void {
  writeWorkflowFile(
    root,
    "src/workflows/index.ts",
    'export * from "./barrel-a";\nexport * from "./barrel-b";\n',
  );
  writeWorkflowFile(
    root,
    "src/workflows/barrel-a.ts",
    'export { layer0_0 as first } from "./workflow-0";\n',
  );
  writeWorkflowFile(
    root,
    "src/workflows/barrel-b.ts",
    'export { default as second } from "./default-workflow";\n',
  );
  writeWorkflowFile(root, "src/workflows/workflow-0.ts", workflowSource(0, 20));
  writeWorkflowFile(
    root,
    "src/workflows/default-workflow.ts",
    'import { Schema, Workflow } from "sideffect";\nconst layer = Workflow.make({ name: "default-re-export", payload: Schema.String }).toLayer(async () => undefined);\nexport default layer;\n',
  );
}

function printMarkdown(results: ReadonlyArray<BenchResult>): void {
  console.log(
    "TypeScript full discovery is a fixture-limited synthetic baseline, not the former production collector.",
  );
  console.log(
    "| fixture | case | files | kB | lines | iterations | mean ms | ms/MB | rss MB | skipped |",
  );
  console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const result of results) {
    console.log(
      `| ${result.fixture} | ${result.caseName} | ${result.files} | ${(result.bytes / 1_000).toFixed(1)} | ${result.lines} | ${result.iterations} | ${result.meanMs.toFixed(3)} | ${result.msPerMb.toFixed(3)} | ${result.rssDeltaMb.toFixed(1)} | ${result.skipped ?? ""} |`,
    );
  }
}
