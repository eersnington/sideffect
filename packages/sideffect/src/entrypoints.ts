import { WorkflowEngine } from "./engine.ts";
import type { NonRetryableErrorConstructor } from "./errors.ts";
import type {
  WorkflowEntrypointConstructor,
  WorkflowLayerAny,
  WorkflowLayerEntries,
} from "./types.ts";

export interface WorkflowEntrypointsOptions {
  readonly WorkflowEntrypoint: WorkflowEntrypointConstructor;
  readonly NonRetryableError?: NonRetryableErrorConstructor;
}

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

export function validateWorkflowExportName(className: string): void {
  if (!isIdentifierName(className)) {
    throw new TypeError(
      `Invalid Cloudflare Workflow class_name "${className}". Sideffect generates a named JavaScript export for each workflow, so class_name must be a valid identifier such as "ResizeImage". Update the Wrangler workflow class_name and the matching Worker export.`,
    );
  }
}

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
