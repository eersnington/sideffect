import { Schema, Workflow } from "sideffect";

import { plainAsyncEcho } from "./steps";

const layer = Workflow.make({
  name: "default-local-layer",
  payload: Schema.Struct({ message: Schema.String }),
}).toLayer(async ({ payload }, step) => {
  const echoed = await step.do(plainAsyncEcho, { message: payload.message });

  return { echoed };
});

export default layer;
