import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/index.ts", "src/cloudflare.ts", "src/vite.ts"],
    deps: {
      neverBundle: ["cloudflare:workers", "cloudflare:workflows"],
      onlyBundle: ["defu"],
    },
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
