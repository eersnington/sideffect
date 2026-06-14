import { Schema, Step, Workflow } from "sideffect";

const workflow = Workflow.make({
  name: "tanstack-workflow",
  payload: Schema.Struct({ message: Schema.String }),
});

const echo = Step.make("echo", {
  payload: Schema.Struct({ message: Schema.String }),
  result: Schema.Struct({ message: Schema.String }),
  run: ({ message }) => ({ message }),
});

export const myWorkflowLayer = workflow.toLayer(async (event, step) => {
  return step.do(echo, { message: event.payload.message });
});
