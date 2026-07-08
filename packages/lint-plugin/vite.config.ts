import { defineConfig } from "vite-plus";

const entry = [
  "src/index.ts",
  "src/eslint.ts",
  "src/oxlint.ts",
  "src/rules/index.ts",
  "src/rules/await-step-calls.ts",
  "src/rules/deterministic-step-names.ts",
  "src/rules/max-step-timeout-30m.ts",
  "src/rules/no-event-mutation.ts",
  "src/rules/no-step-race-any-outside-step.ts",
];

export default defineConfig({
  pack: {
    entry,
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
