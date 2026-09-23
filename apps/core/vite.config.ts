import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const shared = fileURLToPath(new URL("../../shared", import.meta.url));

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./app", import.meta.url)), "@core": fileURLToPath(new URL(".", import.meta.url)), "@shared": shared } },
  server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), shared] } },
});
