import {
  awaitStepCallsRule,
  deterministicStepNamesRule,
  maxStepTimeout30mRule,
  noEventMutationRule,
  noStepRaceAnyOutsideStepRule,
} from "./rules/index.ts";

export const rules = {
  "await-step-calls": awaitStepCallsRule,
  "no-event-mutation": noEventMutationRule,
  "no-step-race-any-outside-step": noStepRaceAnyOutsideStepRule,
  "deterministic-step-names": deterministicStepNamesRule,
  "max-step-timeout-30m": maxStepTimeout30mRule,
};

export const basePlugin = {
  meta: {
    name: "@sideffect/lint",
    namespace: "sideffect",
  },
  rules,
};

export type SideffectLintPlugin = typeof basePlugin;
