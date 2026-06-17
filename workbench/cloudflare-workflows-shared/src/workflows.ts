import { Effect } from "effect";
import { Schema, Workflow } from "sideffect";

import {
  addNumbers,
  callCounterDurableObject,
  decodeAndLabelNumber,
  effectUppercase,
  formatNumber,
  multiplyNumber,
  plainAsyncEcho,
  readStepContext,
  returnBindingMetadata,
  sleepMarker,
} from "./steps";

export const addNumbersLayer = Workflow.make({
  name: "add-numbers",
  payload: Schema.Struct({ left: Schema.Number, right: Schema.Number }),
}).toLayer(async ({ payload }, step) => {
  const sum = await step.do(addNumbers, payload);
  const doubled = await step.do(multiplyNumber, { value: sum, by: 2 });
  const formatted = await step.do(formatNumber, doubled);

  return { sum, doubled, formatted };
});

const normalAsyncWorkflow = Workflow.make({
  name: "normal-async",
  payload: Schema.Struct({ message: Schema.String }),
});

export const normalAsyncLayer = normalAsyncWorkflow.toLayer(async ({ payload }, step) => {
  const echoed = await step.do(plainAsyncEcho, { message: payload.message });

  return { echoed };
});

const effectWrappedWorkflow = Workflow.make({
  name: "effect-wrapped",
  payload: Schema.Struct({ message: Schema.String }),
});

export const effectWrappedLayer = effectWrappedWorkflow.toLayer(
  Effect.fn(function* ({ payload }, step) {
    const upper = yield* Effect.promise(() => step.do(effectUppercase, payload.message));

    return { upper };
  }),
);

const bindingRoundtripWorkflow = Workflow.make({
  name: "binding-roundtrip",
  payload: Schema.Struct({ key: Schema.String }),
});

export const bindingRoundtripLayer = bindingRoundtripWorkflow.toLayer(async ({ payload }, step) => {
  const counter = await step.do(callCounterDurableObject, payload);
  const metadata = await step.do(returnBindingMetadata, {
    binding: "COUNTER",
    className: "Counter",
  });

  return { counter, metadata };
});

const payloadDecodingWorkflow = Workflow.make({
  name: "payload-decoding",
  payload: Schema.Struct({ value: Schema.NumberFromString }),
});

export const payloadDecodingLayer = payloadDecodingWorkflow.toLayer(async (workflow, step) => {
  const decoded = await step.do(decodeAndLabelNumber, { value: workflow.payload.value });

  return {
    payload: workflow.payload,
    eventPayload: workflow.event.payload,
    decoded,
  };
});

const stepContextWorkflow = Workflow.make({
  name: "step-context",
  payload: Schema.Struct({ label: Schema.String }),
});

export const stepContextLayer = stepContextWorkflow.toLayer(async ({ payload }, step) => {
  return step.do(readStepContext, payload, { timeout: "5 minutes" });
});

const pauseAndReturnWorkflow = Workflow.make({
  name: "pause-and-return",
  payload: Schema.Struct({ marker: Schema.String }),
});

export const pauseAndReturnLayer = pauseAndReturnWorkflow.toLayer(async ({ payload }, step) => {
  await step.sleep("pause briefly", "1 second");

  return step.do(sleepMarker, payload);
});
