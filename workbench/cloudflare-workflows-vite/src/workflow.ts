import { Schema, Step, Workflow } from "sideffect";

const workflow = Workflow.make({
  name: "my-workflow",
  payload: Schema.Struct({
    email: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.String),
  }),
});

const collectFiles = Step.make("collect files", {
  payload: Schema.Struct({ email: Schema.String }),
  result: Schema.Struct({ files: Schema.Array(Schema.String) }),
  run: ({ email }) => ({
    files: [`welcome-${email}.pdf`, "report.pdf"],
  }),
});

export const myWorkflowLayer = workflow.toLayer(async (event, step) => {
  const files = await step.do(collectFiles, { email: event.payload.email });
  await step.sleep("wait briefly", "1 second");
  return files;
});
