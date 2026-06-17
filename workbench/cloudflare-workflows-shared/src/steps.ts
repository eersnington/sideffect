import { Effect } from "effect";
import { Schema, Step } from "sideffect";

export const addNumbers = Step.make("add numbers", {
  payload: Schema.Struct({ left: Schema.Number, right: Schema.Number }),
  result: Schema.Number,
  run: ({ left, right }) => left + right,
});

export const multiplyNumber = Step.make("multiply number", {
  payload: Schema.Struct({ value: Schema.Number, by: Schema.Number }),
  result: Schema.Number,
  run: async ({ value, by }) => value * by,
});

export const formatNumber = Step.make("format number", {
  payload: Schema.Number,
  result: Schema.String,
  run: (value) => `value:${value}`,
});

export const plainAsyncEcho = Step.make("plain async echo", {
  payload: Schema.Struct({ message: Schema.String }),
  result: Schema.Struct({ message: Schema.String, mode: Schema.String }),
  run: async ({ message }) => ({ message, mode: "async" }),
});

export const effectUppercase = Step.make("effect uppercase", {
  payload: Schema.String,
  result: Schema.String,
  run: (message) => Effect.succeed(message.toUpperCase()),
});

export const decodeAndLabelNumber = Step.make("decode and label number", {
  payload: Schema.Struct({ value: Schema.Number }),
  result: Schema.Struct({ value: Schema.Number, label: Schema.String }),
  run: ({ value }) => ({ value, label: `decoded:${value}` }),
});

export const readStepContext = Step.make("read step context", {
  payload: Schema.Struct({ label: Schema.String }),
  result: Schema.Struct({
    label: Schema.String,
    step: Schema.String,
    attempt: Schema.Number,
    timeout: Schema.String,
  }),
  run: ({ label }, ctx) => ({
    label,
    step: ctx.step.name,
    attempt: ctx.attempt,
    timeout: String(ctx.config.timeout),
  }),
});

export const callCounterDurableObject = Step.make("call counter durable object", {
  payload: Schema.Struct({ key: Schema.String }),
  result: Schema.Struct({ count: Schema.Number }),
  run: async ({ key }, ctx) => {
    const env = ctx.env as { readonly COUNTER: DurableObjectNamespace };
    const id = env.COUNTER.idFromName(`workflow-${key}`);
    const response = await env.COUNTER.get(id).fetch("https://counter.local/count");

    return response.json();
  },
});

export const sleepMarker = Step.make("sleep marker", {
  payload: Schema.Struct({ marker: Schema.String }),
  result: Schema.Struct({ marker: Schema.String }),
  run: ({ marker }) => ({ marker }),
});

export const returnBindingMetadata = Step.make("return binding metadata", {
  payload: Schema.Struct({ binding: Schema.String, className: Schema.String }),
  result: Schema.Struct({ binding: Schema.String, className: Schema.String }),
  run: ({ binding, className }) => ({ binding, className }),
});
