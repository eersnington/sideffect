import type { WorkflowInput } from "sideffect";

import type defaultDirectWorkflow from "./default-direct-workflow";
import type defaultLocalLayerWorkflow from "./default-local-layer-workflow";
import type {
  addNumbersLayer,
  bindingRoundtripLayer,
  effectWrappedLayer,
  importedDefinitionLayer,
  normalAsyncLayer,
  pauseAndReturnLayer,
  payloadDecodingLayer,
  stepContextLayer,
} from "./workflows";

export interface WorkflowCase {
  readonly key: string;
  readonly binding: string;
  readonly className: string;
  readonly params: unknown;
}

export const sharedWorkflowCases = [
  {
    key: "add-numbers",
    binding: "ADD_NUMBERS",
    className: "AddNumbers",
    params: { left: 2, right: 3 },
  },
  {
    key: "normal-async",
    binding: "NORMAL_ASYNC",
    className: "NormalAsync",
    params: { message: "hello" },
  },
  {
    key: "effect-wrapped",
    binding: "EFFECT_WRAPPED",
    className: "EffectWrapped",
    params: { message: "effect" },
  },
  {
    key: "binding-roundtrip",
    binding: "BINDING_ROUNDTRIP",
    className: "BindingRoundtrip",
    params: { key: "e2e" },
  },
  {
    key: "payload-decoding",
    binding: "PAYLOAD_DECODING",
    className: "PayloadDecoding",
    params: { value: "42" },
  },
  {
    key: "step-context",
    binding: "STEP_CONTEXT",
    className: "StepContext",
    params: { label: "ctx" },
  },
  {
    key: "pause-and-return",
    binding: "PAUSE_AND_RETURN",
    className: "PauseAndReturn",
    params: { marker: "slept" },
  },
  {
    key: "imported-definition",
    binding: "IMPORTED_DEFINITION",
    className: "ImportedDefinition",
    params: { message: "imported" },
  },
  {
    key: "default-direct",
    binding: "DEFAULT_DIRECT",
    className: "DefaultDirect",
    params: { marker: "default-direct" },
  },
  {
    key: "default-local-layer",
    binding: "DEFAULT_LOCAL_LAYER",
    className: "DefaultLocalLayer",
    params: { message: "default-local" },
  },
] as const satisfies ReadonlyArray<WorkflowCase>;

export type SharedWorkflowCase = (typeof sharedWorkflowCases)[number];

interface SharedWorkflowBindings {
  readonly ADD_NUMBERS: Workflow<WorkflowInput<typeof addNumbersLayer>>;
  readonly NORMAL_ASYNC: Workflow<WorkflowInput<typeof normalAsyncLayer>>;
  readonly EFFECT_WRAPPED: Workflow<WorkflowInput<typeof effectWrappedLayer>>;
  readonly BINDING_ROUNDTRIP: Workflow<WorkflowInput<typeof bindingRoundtripLayer>>;
  readonly PAYLOAD_DECODING: Workflow<WorkflowInput<typeof payloadDecodingLayer>>;
  readonly STEP_CONTEXT: Workflow<WorkflowInput<typeof stepContextLayer>>;
  readonly PAUSE_AND_RETURN: Workflow<WorkflowInput<typeof pauseAndReturnLayer>>;
  readonly IMPORTED_DEFINITION: Workflow<WorkflowInput<typeof importedDefinitionLayer>>;
  readonly DEFAULT_DIRECT: Workflow<WorkflowInput<typeof defaultDirectWorkflow>>;
  readonly DEFAULT_LOCAL_LAYER: Workflow<WorkflowInput<typeof defaultLocalLayerWorkflow>>;
}

/** Creates one of the shared Sideffect workflow examples through its generated binding. */
export function createSharedWorkflow(
  env: SharedWorkflowBindings,
  workflowCase: SharedWorkflowCase,
  id: string,
): Promise<WorkflowInstance> {
  switch (workflowCase.binding) {
    case "ADD_NUMBERS":
      return env.ADD_NUMBERS.create({ id, params: workflowCase.params });
    case "NORMAL_ASYNC":
      return env.NORMAL_ASYNC.create({ id, params: workflowCase.params });
    case "EFFECT_WRAPPED":
      return env.EFFECT_WRAPPED.create({ id, params: workflowCase.params });
    case "BINDING_ROUNDTRIP":
      return env.BINDING_ROUNDTRIP.create({ id, params: workflowCase.params });
    case "PAYLOAD_DECODING":
      return env.PAYLOAD_DECODING.create({ id, params: workflowCase.params });
    case "STEP_CONTEXT":
      return env.STEP_CONTEXT.create({ id, params: workflowCase.params });
    case "PAUSE_AND_RETURN":
      return env.PAUSE_AND_RETURN.create({ id, params: workflowCase.params });
    case "IMPORTED_DEFINITION":
      return env.IMPORTED_DEFINITION.create({ id, params: workflowCase.params });
    case "DEFAULT_DIRECT":
      return env.DEFAULT_DIRECT.create({ id, params: workflowCase.params });
    case "DEFAULT_LOCAL_LAYER":
      return env.DEFAULT_LOCAL_LAYER.create({ id, params: workflowCase.params });
  }
}

/** Gets an existing instance of one of the shared Sideffect workflow examples. */
export function getSharedWorkflow(
  env: SharedWorkflowBindings,
  workflowCase: SharedWorkflowCase,
  id: string,
): Promise<WorkflowInstance> {
  return env[workflowCase.binding].get(id);
}
