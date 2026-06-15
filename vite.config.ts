import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "workbench/cloudflare-workflows-tanstack/src/routeTree.gen.ts",
      "workbench/cloudflare-workflows-tanstack/sideffect-env.d.ts",
    ],
  },
  lint: {
    ignorePatterns: [
      "workbench/cloudflare-workflows-tanstack/src/routeTree.gen.ts",
      "workbench/cloudflare-workflows-tanstack/sideffect-env.d.ts",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
