import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";
import type { EcmaScriptModule, Program } from "oxc-parser";

import { collectWorkflowEntries } from "../src/vite.ts";
import { collectWorkflowEntriesWithParser } from "../src/vite/workflow-discovery.ts";
import {
  makeWorkflowDiscoveryParserFromOxc,
  type WorkflowParserResult,
} from "../src/vite/workflow-discovery-parser.ts";

function withTempProject<A>(files: Record<string, string>, run: (root: string) => A): A {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "sideffect-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(root, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, { flag: "w" });
    }

    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("workflow collector discovers namespace Workflow imports", () =>
  withTempProject(
    {
      "src/workflows/my-workflow.ts": `
        import { Schema } from "sideffect";
        import * as Sideffect from "sideffect";

        const Workflow = "not-a-static-member";
        export const unrelated = Sideffect[Workflow].make({
          name: "computed-member",
          payload: Schema.String,
        }).toLayer(async () => undefined);

        export const layer = Sideffect.Workflow.make({
          name: "namespace-workflow",
          payload: Schema.String,
        }).toLayer(async () => undefined);
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows", root).map((workflow) => workflow.config),
      ).toEqual([
        {
          binding: "NAMESPACE_WORKFLOW",
          name: "namespace-workflow",
          class_name: "NamespaceWorkflow",
        },
      ]);
    },
  ));

test("workflow collector follows default re-export chains", () =>
  withTempProject(
    {
      "src/workflows/index.ts": `export { default as renamedLayer } from "./default-workflow";`,
      "src/workflows/default-workflow.ts": `
        import { Schema, Workflow } from "sideffect";

        const layer = Workflow.make({
          name: "default-chain",
          payload: Schema.String,
        }).toLayer(async () => undefined);

        export default layer;
      `,
    },
    (root) => {
      const workflows = collectWorkflowEntries("src/workflows/index.ts", root);
      expect(workflows.map((workflow) => workflow.config)).toEqual([
        { binding: "DEFAULT_CHAIN", name: "default-chain", class_name: "DefaultChain" },
      ]);
      expect(workflows[0]?.layer).toMatchObject({
        exportKind: "default",
        exportName: "default",
      });
    },
  ));

test("workflow collector preserves both branches of a shared re-export graph", () =>
  withTempProject(
    {
      "src/workflows/index.ts": `export * from "./a"; export * from "./b";`,
      "src/workflows/a.ts": `export { layerOne } from "./shared";`,
      "src/workflows/b.ts": `export { layerTwo } from "./shared";`,
      "src/workflows/shared.ts": `
        import { Workflow } from "sideffect";
        export const layerOne = Workflow.make({ name: "one" }).toLayer(async () => undefined);
        export const layerTwo = Workflow.make({ name: "two" }).toLayer(async () => undefined);
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows/index.ts", root).map(
          (workflow) => workflow.config.name,
        ),
      ).toEqual(["one", "two"]);
    },
  ));

test("workflow collector does not cache ancestor-pruned cyclic exports", () =>
  withTempProject(
    {
      "src/workflows/index.ts": `
        export { layerB } from "./a";
        export { layerA as throughB } from "./b";
      `,
      "src/workflows/a.ts": `
        import { Workflow } from "sideffect";
        export const layerA = Workflow.make({ name: "a" }).toLayer(async () => undefined);
        export * from "./b";
      `,
      "src/workflows/b.ts": `
        import { Workflow } from "sideffect";
        export const layerB = Workflow.make({ name: "b" }).toLayer(async () => undefined);
        export * from "./a";
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows/index.ts", root).map(
          (workflow) => workflow.config.name,
        ),
      ).toEqual(["b", "a"]);
    },
  ));

test("workflow collector preserves imported definitions through cyclic re-export branches", () =>
  withTempProject(
    {
      "src/workflows/index.ts": `
        import { definitionB, throughB } from "./definitions";
        export const layerB = definitionB.toLayer(async () => undefined);
        export const layerA = throughB.toLayer(async () => undefined);
      `,
      "src/workflows/definitions/index.ts": `
        export { definitionB } from "./a";
        export { definitionA as throughB } from "./b";
      `,
      "src/workflows/definitions/a.ts": `
        import { Workflow } from "sideffect";
        export const definitionA = Workflow.make({ name: "definition-a" });
        export * from "./b";
      `,
      "src/workflows/definitions/b.ts": `
        import { Workflow } from "sideffect";
        export const definitionB = Workflow.make({ name: "definition-b" });
        export * from "./a";
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows/index.ts", root).map(
          (workflow) => workflow.config.name,
        ),
      ).toEqual(["definition-b", "definition-a"]);
    },
  ));

test("workflow collector resolves source extensions, JavaScript specifiers, and directory indexes", () =>
  withTempProject(
    {
      "src/workflows/index.ts": `
        export * from "./directory";
        export * from "./extensionless";
        export * from "./email.workflow";
        export * from "./js-layer.js";
        export * from "./preferred.js";
        export * from "./esm-layer.mjs";
        export * from "./common-layer.cjs";
        export * from "./jsx-layer.jsx";
      `,
      "src/workflows/directory/index.ts": `
        import { Workflow } from "sideffect";
        export const directoryLayer = Workflow.make({ name: "directory-index" }).toLayer(async () => undefined);
      `,
      "src/workflows/extensionless.mts": `
        import { Workflow } from "sideffect";
        export const extensionlessLayer = Workflow.make({ name: "extensionless-mts" }).toLayer(async () => undefined);
      `,
      "src/workflows/email.workflow.ts": `
        import { Workflow } from "sideffect";
        export const dottedLayer = Workflow.make({ name: "dotted-stem" }).toLayer(async () => undefined);
      `,
      "src/workflows/js-layer.ts": `
        import { Workflow } from "sideffect";
        export const jsMappedLayer = Workflow.make({ name: "js-to-ts" }).toLayer(async () => undefined);
      `,
      "src/workflows/preferred.js": `
        import { Workflow } from "sideffect";
        export const preferredLayer = Workflow.make({ name: "exact-js" }).toLayer(async () => undefined);
      `,
      "src/workflows/preferred.ts": `
        import { Workflow } from "sideffect";
        export const preferredLayer = Workflow.make({ name: "mapped-ts" }).toLayer(async () => undefined);
      `,
      "src/workflows/esm-layer.mts": `
        import { Workflow } from "sideffect";
        export const esmLayer = Workflow.make({ name: "esm-mts" }).toLayer(async () => undefined);
      `,
      "src/workflows/common-layer.cts": `
        import { Workflow } from "sideffect";
        export const commonLayer = Workflow.make({ name: "common-cts" }).toLayer(async () => undefined);
      `,
      "src/workflows/jsx-layer.tsx": `
        import { Workflow } from "sideffect";
        export const jsxLayer = Workflow.make({ name: "jsx-tsx" }).toLayer(async () => undefined);
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows/index.ts", root).map(
          (workflow) => workflow.config.name,
        ),
      ).toEqual([
        "directory-index",
        "extensionless-mts",
        "dotted-stem",
        "js-to-ts",
        "exact-js",
        "esm-mts",
        "common-cts",
        "jsx-tsx",
      ]);
    },
  ));

test("workflow collector only trusts Workflow bindings imported from sideffect", () =>
  withTempProject(
    {
      "src/workflows/workflows.ts": `
        import { Workflow as SideffectWorkflow } from "sideffect";

        const Workflow = { make: () => ({ toLayer: () => ({}) }) };
        export const unrelated = Workflow.make({ name: "unrelated" }).toLayer();
        export const sideffect = SideffectWorkflow.make({ name: "sideffect" }).toLayer(async () => undefined);
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows", root).map((workflow) => workflow.config.name),
      ).toEqual(["sideffect"]);
    },
  ));

test("workflow collector rejects workflow names that a later spread may override", () =>
  withTempProject(
    {
      "src/workflows/workflows.ts": `
        import { Workflow } from "sideffect";

        const override = { name: "runtime-name" };
        export const dynamic = Workflow.make({ name: "stale-name", ...override }).toLayer(async () => undefined);
        export const staticLayer = Workflow.make({ ...override, name: "static-name" }).toLayer(async () => undefined);
      `,
    },
    (root) => {
      expect(
        collectWorkflowEntries("src/workflows", root).map((workflow) => workflow.config.name),
      ).toEqual(["static-name"]);
    },
  ));

test("workflow collector reports parser failures with source context", () =>
  withTempProject(
    {
      "src/workflows/broken.ts": `
        import { Workflow } from "sideffect";
        export const layer = Workflow.make({ name: "broken" }).toLayer(async () => {
      `,
    },
    (root) => {
      expect(() => collectWorkflowEntries("src/workflows", root)).toThrow(
        /could not parse workflow source .*broken\.ts.*No workflow config was written/s,
      );
    },
  ));

test("workflow collector renders thrown parser failures without retrying", () =>
  withTempProject(
    {
      "src/workflows/workflow.ts": `export const value = 1;`,
    },
    (root) => {
      const calls: Array<unknown> = [];
      const parser = makeWorkflowDiscoveryParserFromOxc({
        rawTransferSupported: () => true,
        parseSync(_filePath, _source, options) {
          calls.push(options);
          throw new Error("native parser failure");
        },
      });

      expect(() => collectWorkflowEntriesWithParser("src/workflows", root, parser)).toThrow(
        /could not invoke oxc-parser .*No workflow config was written/s,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ experimentalRawTransfer: true });
    },
  ));

test("workflow collector reports unresolved local re-exports", () =>
  withTempProject(
    {
      "src/workflows/index.ts": `export { layer } from "./missing";`,
    },
    (root) => {
      expect(() => collectWorkflowEntries("src/workflows/index.ts", root)).toThrow(
        /could not resolve workflow re-export module "\.\/missing"/,
      );
    },
  ));

test("workflow parser selects raw transfer when supported", () => {
  const calls: Array<unknown> = [];
  const parser = makeWorkflowDiscoveryParserFromOxc(recordingParser(true, calls));

  parser.parse("workflow.ts", "export const value = 1;");

  expect(parser.selection).toBe("raw-transfer");
  expect(calls).toEqual([expect.objectContaining({ experimentalRawTransfer: true })]);
});

test("workflow parser selects standard mode when raw transfer is unavailable", () => {
  const calls: Array<unknown> = [];
  const parser = makeWorkflowDiscoveryParserFromOxc(recordingParser(false, calls));

  parser.parse("workflow.ts", "export const value = 1;");

  expect(parser.selection).toBe("standard");
  expect(calls).toEqual([expect.not.objectContaining({ experimentalRawTransfer: true })]);
});

test("workflow parser does not retry standard parsing after raw-transfer parse failure", () => {
  const calls: Array<unknown> = [];
  const parser = makeWorkflowDiscoveryParserFromOxc({
    rawTransferSupported: () => true,
    parseSync(_filePath, _source, options) {
      calls.push(options);
      return parseResult([{ message: "bad syntax" }]);
    },
  });

  expect(parser.parse("workflow.ts", "broken").errors[0]?.message).toBe("bad syntax");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ experimentalRawTransfer: true });
});

function recordingParser(rawTransferSupported: boolean, calls: Array<unknown>) {
  return {
    rawTransferSupported: () => rawTransferSupported,
    parseSync(_filePath: string, _source: string, options: unknown) {
      calls.push(options);
      return parseResult([]);
    },
  };
}

function parseResult(errors: ReadonlyArray<{ readonly message: string }>): WorkflowParserResult {
  const program: Program = {
    type: "Program",
    start: 0,
    end: 0,
    body: [],
    sourceType: "module",
    hashbang: null,
  };
  const module: EcmaScriptModule = {
    hasModuleSyntax: true,
    staticImports: [],
    staticExports: [],
    dynamicImports: [],
    importMetas: [],
  };
  return {
    program,
    module,
    errors,
  };
}
