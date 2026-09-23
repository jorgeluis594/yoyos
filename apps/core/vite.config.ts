import { reactRouter } from "@react-router/dev/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const shared = fileURLToPath(new URL("../../shared", import.meta.url));

export default defineConfig({
  plugins: [reactRouter()],
  resolve: { alias: { "@shared": shared } },
  server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), shared] } },
});
