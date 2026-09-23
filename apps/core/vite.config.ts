import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) } },
});
