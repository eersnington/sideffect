import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint, RuleTester } from "eslint";
import { expect, test } from "vite-plus/test";

import eslintPlugin from "../src/eslint.ts";
import { awaitStepCallsRule } from "../src/rules/await-step-calls.ts";
import { deterministicStepNamesRule } from "../src/rules/deterministic-step-names.ts";
import { maxStepTimeout30mRule } from "../src/rules/max-step-timeout-30m.ts";
import { noEventMutationRule } from "../src/rules/no-event-mutation.ts";
import { noStepRaceAnyOutsideStepRule } from "../src/rules/no-step-race-any-outside-step.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

test("await-step-calls", () => {
  tester.run("await-step-calls", awaitStepCallsRule as never, {
    valid: [
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            await step.do("fetch user", async () => event.payload.user);
            return step.sleep("pause", "1 second");
          }
        }
      `,
      `
        import { Workflow, Step } from "sideffect";
        const fetchUser = Step.make("fetch user", {});
        Workflow.make({ name: "users" }).toLayer(async (workflow, step) => {
          return await Promise.all([
            step.do(fetchUser, workflow.payload),
            step.sleep("pause", "1 second"),
          ]);
        });
      `,
      `
        import { Effect, Workflow, Step } from "sideffect";
        const fetchUser = Step.make("fetch user", {});
        Workflow.make({ name: "users" }).toLayer(
          Effect.fn(function* ({ payload }, step) {
            return yield* Effect.promise(() => step.do(fetchUser, payload));
          }),
        );
      `,
      `
        import { Effect, Workflow, Step } from "sideffect";
        const fetchUser = Step.make("fetch user", {});
        Workflow.make({ name: "users" }).toLayer(
          Effect.fn(function* ({ payload }, step) {
            return yield* Effect.tryPromise({
              try: () => step.do(fetchUser, payload),
              catch: (error) => error,
            }).pipe(Effect.catchAll((error) => Effect.fail(error)));
          }),
        );
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return step.do("fetch user", async () => event.payload.user).then((user) => user);
          }
        }
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return await Promise.allSettled([
              step.do("fetch user", async () => event.payload.user),
            ]);
          }
        }
      `,
      `
        import { Effect, Workflow, Step } from "sideffect";
        const fetchUser = Step.make("fetch user", {});
        Workflow.make({ name: "users" }).toLayer(
          Effect.fn(function* ({ payload }, step) {
            return yield* Effect.promise(() => {
              return step.do(fetchUser, payload);
            });
          }),
        );
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return Promise.all([1, 2].map(async (id) => {
              return await step.do("fetch " + id, async () => event.payload.user);
            }));
          }
        }
      `,
    ],
    invalid: [
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              step.do("fetch user", async () => event.payload.user);
            }
          }
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import { Workflow } from "sideffect";
          Workflow.make({ name: "users" }).toLayer(async (workflow, step) => {
            const promise = step.sleep("pause", "1 second");
            return promise;
          });
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import { Workflow } from "sideffect";
          export const usersWorkflow = Workflow.make({ name: "users" });
          usersWorkflow.toLayer(async (workflow, step) => {
            step.sleep("pause", "1 second");
          });
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import { importedDefinitionWorkflow } from "./imported-definition";
          importedDefinitionWorkflow.toLayer(async (workflow, step) => {
            step.sleep("pause", "1 second");
          });
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import { Effect, Workflow, Step } from "sideffect";
          const fetchUser = Step.make("fetch user", {});
          Workflow.make({ name: "users" }).toLayer(
            Effect.fn(function* ({ payload }, step) {
              step.do(fetchUser, payload);
            }),
          );
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              [1].map(() => step.do("fetch user", async () => event.payload.user));
            }
          }
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              [1].map(async () => await step.do("fetch user", async () => event.payload.user));
            }
          }
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
      {
        code: `
          import * as cf from "cloudflare:workers";
          export class MyWorkflow extends cf.WorkflowEntrypoint {
            async run(event, step) {
              step.do("fetch user", async () => event.payload.user);
            }
          }
        `,
        errors: [{ messageId: "danglingStepCall" }],
      },
    ],
  });
});

test("no-event-mutation", () => {
  tester.run("no-event-mutation", noEventMutationRule as never, {
    valid: [
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            const nextPayload = { ...event.payload, user: "updated" };
            return step.do("save", async () => nextPayload);
          }
        }
      `,
      `
        class WorkflowEntrypoint {}
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            step.do("local", async () => event.payload);
          }
        }
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            let payload = event.payload;
            payload = { user: "updated" };
            return step.do("save", async () => payload);
          }
        }
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            const payload = event.payload;
            {
              const payload = { items: [] };
              payload.items.push("local");
            }
            return step.do("save", async () => payload);
          }
        }
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            const payload = event.payload;
            {
              const payload = { items: [] };
              Object.assign(payload, { user: "local" });
            }
            return step.do("save", async () => payload);
          }
        }
      `,
    ],
    invalid: [
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              event.payload.user = "updated";
              return step.do("save", async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { Workflow } from "sideffect";
          Workflow.make({ name: "users" }).toLayer(async ({ payload }, step) => {
            payload.user = "updated";
            return step.sleep("pause", "1 second");
          });
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { Workflow } from "sideffect";
          Workflow.make({ name: "users" }).toLayer(async (workflow, step) => {
            workflow.event.payload.user = "updated";
            return step.sleep("pause", "1 second");
          });
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              const { payload } = event;
              payload.user = "updated";
              return step.do("save", async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              event.payload.items.push("updated");
              return step.do("save", async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { Workflow } from "sideffect";
          Workflow.make({ name: "users" }).toLayer(async (workflow, step) => {
            const payload = workflow.payload;
            payload.items.splice(0, 1);
            return step.sleep("pause", "1 second");
          });
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              Object.assign(event.payload, { user: "updated" });
              return step.do("save", async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              const payload = event.payload;
              Object.assign(payload, { user: "updated" });
              return step.do("save", async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "eventMutation" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              const payload = event.payload;
              {
                const payload = { items: [] };
                payload.items.push("local");
              }
              payload.items.push("updated");
              return step.do("save", async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "eventMutation" }],
      },
    ],
  });
});

test("no-step-race-any-outside-step", () => {
  tester.run("no-step-race-any-outside-step", noStepRaceAnyOutsideStepRule as never, {
    valid: [
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return step.do("race", async () => Promise.race([
              step.do("slow", async () => "slow"),
              step.do("fast", async () => "fast"),
            ]));
          }
        }
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return Promise.race([
              () => step.do("slow", async () => "slow"),
              Promise.resolve("fast"),
            ]);
          }
        }
      `,
    ],
    invalid: [
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return Promise.race([
                step.do("slow", async () => "slow"),
                step.do("fast", async () => "fast"),
              ]);
            }
          }
        `,
        errors: [{ messageId: "stepRaceOutsideStep" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return Promise.race([1, 2].map(async (id) => {
                return await step.do("fetch " + id, async () => id);
              }));
            }
          }
        `,
        errors: [{ messageId: "stepRaceOutsideStep" }],
      },
    ],
  });
});

test("eslint loads the public plugin export", async () => {
  expect(eslintPlugin.configs.recommended).toBeDefined();
  expect(eslintPlugin.configs.strict).toBeDefined();

  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        plugins: { sideffect: eslintPlugin as never },
        rules: { "sideffect/await-step-calls": "error" },
      },
    ],
  });

  const [result] = await eslint.lintText(`
    import { WorkflowEntrypoint } from "cloudflare:workers";
    export class MyWorkflow extends WorkflowEntrypoint {
      async run(event, step) {
        step.do("fetch user", async () => event.payload.user);
      }
    }
  `);

  expect(result?.messages.map((message) => message.ruleId)).toContain("sideffect/await-step-calls");
});

test("deterministic-step-names", () => {
  tester.run("deterministic-step-names", deterministicStepNamesRule as never, {
    valid: [
      `
        import { Step, Workflow } from "sideffect";
        const fetchUser = Step.make("fetch user", {});
        Workflow.make({ name: "users" }).toLayer(async (workflow, step) => {
          return step.do(fetchUser, workflow.payload);
        });
      `,
    ],
    invalid: [
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do(\`run at \${Date.now()}\`, async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "nondeterministicStepName" }],
      },
      {
        code: `
          import { Step } from "sideffect";
          const bad = Step.make(\`fetch-\${Math.random()}\`, {});
        `,
        errors: [{ messageId: "nondeterministicStepName" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do(Date(), async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "nondeterministicStepName" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do(globalThis.crypto.randomUUID(), async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "nondeterministicStepName" }],
      },
    ],
  });
});

test("max-step-timeout-30m", () => {
  tester.run("max-step-timeout-30m", maxStepTimeout30mRule as never, {
    valid: [
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return step.do("fetch", { timeout: "30 minutes" }, async () => event.payload);
          }
        }
      `,
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            return step.do("fetch", { timeout: 1800000 }, async () => event.payload);
          }
        }
      `,
    ],
    invalid: [
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do("fetch", { timeout: "2 hours" }, async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "timeoutTooLong" }],
      },
      {
        code: `
          import { Workflow, Step } from "sideffect";
          const fetchUser = Step.make("fetch user", {});
          Workflow.make({ name: "users" }).toLayer(async (workflow, step) => {
            return step.do(fetchUser, workflow.payload, { timeout: "45 minutes" });
          });
        `,
        errors: [{ messageId: "timeoutTooLong" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do("fetch", { timeout: 1800001 }, async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "timeoutTooLong" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do("fetch", { timeout: "1 day" }, async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "timeoutTooLong" }],
      },
      {
        code: `
          import { WorkflowEntrypoint } from "cloudflare:workers";
          export class MyWorkflow extends WorkflowEntrypoint {
            async run(event, step) {
              return step.do("fetch", { timeout: "1 week" }, async () => event.payload);
            }
          }
        `,
        errors: [{ messageId: "timeoutTooLong" }],
      },
    ],
  });
});

test("oxlint loads the source plugin", () => {
  const root = mkdtempSync(join(tmpdir(), "sideffect-lint-"));
  try {
    writeFileSync(
      join(root, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [
          {
            name: "sideffect",
            specifier: join(packageRoot, "src/oxlint.ts"),
          },
        ],
        rules: {
          "sideffect/await-step-calls": "error",
        },
      }),
    );
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src/workflow.js"),
      `
        import { WorkflowEntrypoint } from "cloudflare:workers";
        export class MyWorkflow extends WorkflowEntrypoint {
          async run(event, step) {
            step.do("fetch user", async () => event.payload.user);
          }
        }
      `,
    );

    let output: string | undefined;
    try {
      execFileSync(
        join(packageRoot, "node_modules/oxlint/bin/oxlint"),
        ["--config", ".oxlintrc.json", "src/workflow.js"],
        {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (error: unknown) {
      output =
        error instanceof Error && "stdout" in error && "stderr" in error
          ? `${String(error.stdout)}\n${String(error.stderr)}`
          : String(error);
    }
    expect(output).toContain("await-step-calls");
    expect(output).toContain("Workflow step call is not awaited");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oxlint createOnce state is reset between files", () => {
  const root = mkdtempSync(join(tmpdir(), "sideffect-lint-"));
  try {
    writeFileSync(
      join(root, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [
          {
            name: "sideffect",
            specifier: join(packageRoot, "src/oxlint.ts"),
          },
        ],
        rules: {
          "sideffect/await-step-calls": "error",
        },
      }),
    );
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src/a.js"),
      `
        import { Workflow } from "sideffect";
        const externalWorkflow = Workflow.make({ name: "external" });
        externalWorkflow.toLayer(async (workflow, step) => {
          return step.sleep("pause", "1 second");
        });
      `,
    );
    writeFileSync(
      join(root, "src/b.js"),
      `
        externalWorkflow.toLayer(async (workflow, step) => {
          step.sleep("pause", "1 second");
        });
      `,
    );

    const output = execFileSync(
      join(packageRoot, "node_modules/oxlint/bin/oxlint"),
      ["--config", ".oxlintrc.json", "src/a.js", "src/b.js"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      },
    );

    expect(output).not.toContain("sideffect/await-step-calls");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
