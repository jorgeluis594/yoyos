import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const core = fileURLToPath(new URL("..", import.meta.url));
const shared = fileURLToPath(new URL("../../../shared", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../app", import.meta.url)),
      "@core": core,
      "@shared": shared,
    },
  },
  server: { fs: { allow: [core, shared] } },
});
