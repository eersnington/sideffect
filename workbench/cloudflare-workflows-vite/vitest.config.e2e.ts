import { defineConfig } from "vite-plus";

export default defineConfig({
  publicDir: false,
  test: {
    fileParallelism: false,
    testTimeout: 90_000,
  },
});
