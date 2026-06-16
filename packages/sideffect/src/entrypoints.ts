import { WorkflowEngine } from "./engine.ts";
import type { NonRetryableErrorConstructor } from "./errors.ts";
import type {
  WorkflowEntrypointConstructor,
  WorkflowLayerAny,
  WorkflowLayerEntries,
} from "./types.ts";

/** @internal Dependencies needed to create native Cloudflare workflow entrypoints. */
export interface WorkflowEntrypointsOptions {
  /** Cloudflare `WorkflowEntrypoint` constructor. */
  readonly WorkflowEntrypoint: WorkflowEntrypointConstructor;
  /** Optional Cloudflare native `NonRetryableError` constructor. */
  readonly NonRetryableError?: NonRetryableErrorConstructor;
}

/** @internal Creates one Cloudflare workflow entrypoint class per named layer. */
export function makeWorkflowEntrypoints<const Entries extends WorkflowLayerEntries>(
  entries: Entries,
  options: WorkflowEntrypointsOptions,
): { readonly [K in keyof Entries]: WorkflowEntrypointConstructor } {
  const result: Record<string, WorkflowEntrypointConstructor> = {};

  for (const [className, layer] of Object.entries(entries)) {
    validateWorkflowExportName(className);
    validateWorkflowLayer(layer, className);
    result[className] = WorkflowEngine.make(className, layer, options.WorkflowEntrypoint, {
      NonRetryableError: options.NonRetryableError,
    });
  }

  return result as { readonly [K in keyof Entries]: WorkflowEntrypointConstructor };
}

/** @internal Ensures a workflow class name can be emitted as a JavaScript export. */
export function validateWorkflowExportName(className: string): void {
  if (!isIdentifierName(className)) {
    throw new TypeError(
      `Invalid Cloudflare Workflow class_name "${className}". Sideffect generates a named JavaScript export for each workflow, so class_name must be a valid identifier such as "ResizeImage". Update the Wrangler workflow class_name and the matching Worker export.`,
    );
  }
}

/** @internal Validates that a Worker export is a Sideffect workflow layer. */
export function validateWorkflowLayer(
  layer: unknown,
  className: string,
): asserts layer is WorkflowLayerAny {
  if (!isWorkflowLayer(layer)) {
    throw new TypeError(
      `Expected Worker export "${className}" to be a Sideffect WorkflowLayer. Export a layer with the same name as the Wrangler workflow class_name, for example: export { resizeImageWorkflowLayer as ${className} } from "./workflows/resize-image".`,
    );
  }
}

/** @internal Runtime predicate for Sideffect workflow layers. */
export function isWorkflowLayer(value: unknown): value is WorkflowLayerAny {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "WorkflowLayer"
  );
}

function isIdentifierName(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}
