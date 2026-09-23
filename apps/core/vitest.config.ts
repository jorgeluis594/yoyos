import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./app", import.meta.url)),
    "@core": fileURLToPath(new URL(".", import.meta.url)),
    "@shared": fileURLToPath(new URL("../../shared", import.meta.url)),
  } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.{test,spec}.{ts,tsx}", "app/**/*.{test,spec}.{ts,tsx}"] } },
      { extends: true, test: { name: "integration", include: ["src/**/*.test.mjs"], testTimeout: 60_000 } },
      { extends: true, test: { name: "e2e", include: ["tests/e2e/**/*.spec.ts"], testTimeout: 60_000, globalSetup: ["./tests/e2e/server-setup.ts"] } },
    ],
  },
});
