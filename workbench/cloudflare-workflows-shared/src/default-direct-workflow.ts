import { Schema, Workflow } from "sideffect";

import { sleepMarker } from "./steps";

export default Workflow.make({
  name: "default-direct",
  payload: Schema.Struct({ marker: Schema.String }),
}).toLayer(async ({ payload }, step) => step.do(sleepMarker, payload));
