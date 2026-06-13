import { Schema } from "effect";

import type { WorkflowDefinition, WorkflowLayer, WorkflowRun } from "./types.ts";

export interface WorkflowMakeOptions<Payload> {
  readonly name: string;
  readonly payload: Schema.Schema<Payload>;
}

export const Workflow = {
  make<Payload>(options: WorkflowMakeOptions<Payload>): WorkflowDefinition<Payload> {
    const definition: WorkflowDefinition<Payload> = {
      _tag: "WorkflowDefinition",
      name: options.name,
      payloadSchema: options.payload,
      toLayer<Result>(run: WorkflowRun<Payload, Result>): WorkflowLayer<Payload, Result> {
        return {
          _tag: "WorkflowLayer",
          workflow: definition,
          run,
        };
      },
    };

    return definition;
  },
};
