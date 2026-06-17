import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { withCloudflareWorkflows } from "sideffect/vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    withCloudflareWorkflows(cloudflare, {
      viteEnvironment: { name: "ssr" },
      workflowPaths: [
        "../cloudflare-workflows-shared/src/workflows.ts",
        "../cloudflare-workflows-shared/src/default-direct-workflow.ts",
        "../cloudflare-workflows-shared/src/default-local-layer-workflow.ts",
      ],
      config: {
        durable_objects: {
          bindings: [{ name: "COUNTER", class_name: "Counter" }],
        },
        migrations: [{ tag: "v1", new_sqlite_classes: ["Counter"] }],
        workflows: [{ binding: "NATIVE_CHECK", name: "native-check", class_name: "NativeCheck" }],
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
