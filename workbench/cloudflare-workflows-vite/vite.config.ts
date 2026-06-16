import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { withCloudflareWorkflows } from "sideffect/vite";

export default defineConfig({
  plugins: [
    withCloudflareWorkflows(cloudflare, {
      config: {
        durable_objects: {
          bindings: [{ name: "COUNTER", class_name: "Counter" }],
        },
        migrations: [{ tag: "v1", new_sqlite_classes: ["Counter"] }],
      },
    }),
  ],
});
