import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["workbench/cloudflare-workflows-tanstack/src/routeTree.gen.ts"],
  },
  lint: {
    ignorePatterns: ["workbench/cloudflare-workflows-tanstack/src/routeTree.gen.ts"],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
