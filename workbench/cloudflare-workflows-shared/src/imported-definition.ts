import { Schema, Workflow } from "sideffect";

export const importedDefinitionWorkflow = Workflow.make({
  name: "imported-definition",
  payload: Schema.Struct({ message: Schema.String }),
});
