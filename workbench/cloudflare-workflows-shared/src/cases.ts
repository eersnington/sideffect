export interface SharedWorkflowCase {
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
] satisfies Array<SharedWorkflowCase>;
