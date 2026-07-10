import { performance } from "node:perf_hooks";

import { Effect } from "effect";

import { Schema, Step, Workflow, WorkflowEngine } from "../src/index.ts";
import type { NativeWorkflowStep, WorkflowLayer } from "../src/types.ts";
import type { WorkflowStepContext, WorkflowStepEvent } from "cloudflare:workers";

interface Payload {
  readonly id: string;
  readonly count: number;
}

interface BenchResult {
  readonly name: string;
  readonly steps: number;
  readonly samplesMs: ReadonlyArray<number>;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly deltaFromBaselineMs: number;
  readonly microsecondsPerStep: number;
}

interface BenchCase {
  readonly name: string;
  readonly makeLayer: (steps: number) => WorkflowLayer<Payload, Payload>;
}

interface Options {
  readonly steps: ReadonlyArray<number>;
  readonly samples: number;
}

const payload: Payload = { id: "img_123", count: 1 };
const payloadSchema = Schema.Struct({ id: Schema.String, count: Schema.Number });
const workflow = Workflow.make({ name: "bench-workflow", payload: payloadSchema });
const nativeStep = fakeNativeStep();

const directStep = Step.make("direct step", {
  payload: payloadSchema,
  result: payloadSchema,
  run: (input: Payload) => input,
});

const promiseStep = Step.make("promise step", {
  payload: payloadSchema,
  result: payloadSchema,
  run: (input: Payload) => Promise.resolve(input),
});

const effectSucceedStep = Step.make("effect succeed step", {
  payload: payloadSchema,
  result: payloadSchema,
  run: (input: Payload) => Effect.succeed(input),
});

const untraced = Effect.fnUntraced(function* (input: Payload) {
  return yield* Effect.succeed(input);
});

const effectFnUntracedStep = Step.make("effect fn untraced step", {
  payload: payloadSchema,
  result: payloadSchema,
  run: (input: Payload) => untraced(input),
});

const traced = Effect.fn("benchmark.tracedStep")((input: Payload) => Effect.succeed(input));

const effectFnTracedStep = Step.make("effect fn traced step", {
  payload: payloadSchema,
  result: payloadSchema,
  run: (input: Payload) => traced(input),
});

const cases: ReadonlyArray<BenchCase> = [
  {
    name: "sideffect-direct-struct",
    makeLayer: (steps) => workflow.toLayer((_workflow, step) => runSteps(steps, step, directStep)),
  },
  {
    name: "sideffect-promise-step",
    makeLayer: (steps) => workflow.toLayer((_workflow, step) => runSteps(steps, step, promiseStep)),
  },
  {
    name: "sideffect-effect-succeed-step",
    makeLayer: (steps) =>
      workflow.toLayer((_workflow, step) => runSteps(steps, step, effectSucceedStep)),
  },
  {
    name: "sideffect-effect-fn-untraced-step",
    makeLayer: (steps) =>
      workflow.toLayer((_workflow, step) => runSteps(steps, step, effectFnUntracedStep)),
  },
  {
    name: "sideffect-effect-fn-traced-step",
    makeLayer: (steps) =>
      workflow.toLayer((_workflow, step) => runSteps(steps, step, effectFnTracedStep)),
  },
  {
    name: "sideffect-effect-workflow",
    makeLayer: (steps) =>
      workflow.toLayer((_workflow, step) =>
        Effect.tryPromise({
          try: () => runSteps(steps, step, directStep),
          catch: (cause) => cause,
        }),
      ),
  },
  {
    name: "sideffect-effect-per-step-wrapper",
    makeLayer: (steps) =>
      workflow.toLayer(async (_workflow, step) => {
        let current = payload;
        for (let index = 0; index < steps; index++) {
          current = await Effect.runPromise(
            Effect.tryPromise({
              try: () => step.do(directStep, current),
              catch: (cause) => cause,
            }),
          );
        }
        return current;
      }),
  },
];

const options = parseOptions(process.argv.slice(2));
const results = await runBenchmarks(options);

printMarkdown(results);
console.log("\nJSON:");
console.log(JSON.stringify(results, null, 2));

async function runBenchmarks(options: Options): Promise<ReadonlyArray<BenchResult>> {
  const results: Array<BenchResult> = [];

  for (const steps of options.steps) {
    const baseline = await runNativeBaseline(steps, options.samples);
    results.push(baseline);

    for (const benchCase of cases) {
      results.push(await runCase(benchCase, steps, options.samples, baseline.medianMs));
    }
  }

  return results;
}

async function runNativeBaseline(steps: number, samples: number): Promise<BenchResult> {
  await runNativeSteps(steps);
  const samplesMs = await sample(samples, () => runNativeSteps(steps));
  return summarize("native-fake-baseline", steps, samplesMs, 0);
}

async function runCase(
  benchCase: BenchCase,
  steps: number,
  samples: number,
  baselineMs: number,
): Promise<BenchResult> {
  const layer = benchCase.makeLayer(steps);
  await runLayer(layer);
  const samplesMs = await sample(samples, () => runLayer(layer));
  return summarize(benchCase.name, steps, samplesMs, baselineMs);
}

async function sample(
  samples: number,
  run: () => Promise<unknown>,
): Promise<ReadonlyArray<number>> {
  const durations: Array<number> = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    await run();
    durations.push(performance.now() - start);
  }
  return durations;
}

function summarize(
  name: string,
  steps: number,
  samplesMs: ReadonlyArray<number>,
  baselineMs: number,
): BenchResult {
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    name,
    steps,
    samplesMs,
    medianMs,
    minMs: sorted[0] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    deltaFromBaselineMs: medianMs - baselineMs,
    microsecondsPerStep: (medianMs * 1000) / steps,
  };
}

async function runLayer(layer: WorkflowLayer<Payload, Payload>): Promise<Payload> {
  return WorkflowEngine.run(layer, {
    env: {},
    ctx: {},
    event: {
      payload,
      timestamp: new Date(0),
      instanceId: "benchmark-instance",
      workflowName: "bench-workflow",
    },
    step: nativeStep,
  });
}

async function runNativeSteps(steps: number): Promise<Payload> {
  let current = payload;
  for (let index = 0; index < steps; index++) {
    current = await nativeStep.do("native step", () => current);
  }
  return current;
}

async function runSteps(
  steps: number,
  step: Parameters<WorkflowLayer<Payload, Payload>["run"]>[1],
  stepDefinition: typeof directStep,
): Promise<Payload> {
  let current = payload;
  for (let index = 0; index < steps; index++) {
    current = await step.do(stepDefinition, current);
  }
  return current;
}

function fakeNativeStep(): NativeWorkflowStep {
  return {
    do: (async (...args: Array<unknown>) => {
      const callback = args.find((arg) => typeof arg === "function") as (
        context: WorkflowStepContext,
      ) => Payload | Promise<Payload>;
      return callback({ step: { name: String(args[0]), count: 1 }, attempt: 1, config: {} });
    }) as NativeWorkflowStep["do"],
    async sleep() {},
    async sleepUntil() {},
    waitForEvent: (async <A = unknown>(
      _name: string,
      eventOptions: { readonly type: string; readonly timeout?: string | number },
    ): Promise<WorkflowStepEvent<A>> => ({
      payload: undefined as A,
      timestamp: new Date(0),
      type: eventOptions.type,
    })) as NativeWorkflowStep["waitForEvent"],
  };
}

function parseOptions(args: ReadonlyArray<string>): Options {
  const steps = valueFor(args, "--steps")
    ?.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0) ?? [1_000, 10_000];
  const samples = Number(valueFor(args, "--samples") ?? "5");

  return {
    steps,
    samples: Number.isInteger(samples) && samples > 0 ? samples : 5,
  };
}

function valueFor(args: ReadonlyArray<string>, name: string): string | undefined {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function printMarkdown(results: ReadonlyArray<BenchResult>): void {
  console.log("| steps | case | median ms | delta ms | us/step | min ms | max ms |");
  console.log("|---:|---|---:|---:|---:|---:|---:|");
  for (const result of results) {
    console.log(
      `| ${result.steps} | ${result.name} | ${format(result.medianMs)} | ${format(result.deltaFromBaselineMs)} | ${format(result.microsecondsPerStep)} | ${format(result.minMs)} | ${format(result.maxMs)} |`,
    );
  }
}

function format(value: number): string {
  return value.toFixed(3);
}
