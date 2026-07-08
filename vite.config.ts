import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "workbench/cloudflare-workflows-tanstack/src/routeTree.gen.ts",
      "workbench/**/sideffect-env.d.ts",
    ],
  },
  lint: {
    jsPlugins: [{ name: "sideffect", specifier: "./packages/lint-plugin/src/oxlint.ts" }],
    ignorePatterns: [
      "workbench/cloudflare-workflows-tanstack/src/routeTree.gen.ts",
      "workbench/**/sideffect-env.d.ts",
    ],
    rules: {
      "sideffect/await-step-calls": "error",
      "sideffect/no-event-mutation": "error",
      "sideffect/no-step-race-any-outside-step": "warn",
      "sideffect/deterministic-step-names": "warn",
      "sideffect/max-step-timeout-30m": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
