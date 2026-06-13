import { makeStepDefinition } from "./step.ts";
import type { RollbackHandler, StepDefinition } from "./types.ts";

export const Rollback = {
  with<Payload, Result>(handler: RollbackHandler<Payload, Result>) {
    return (step: StepDefinition<Payload, Result>): StepDefinition<Payload, Result> =>
      makeStepDefinition({
        name: step.name,
        payloadSchema: step.payloadSchema,
        resultSchema: step.resultSchema,
        run: step.run,
        rollback: handler,
      });
  },
};
