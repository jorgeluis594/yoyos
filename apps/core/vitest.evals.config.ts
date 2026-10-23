import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import testConfig from "./vitest.config.js";

// AI evals call real models and cost money, so they run only through `pnpm eval`, never in CI.
export default defineConfig({
  resolve: testConfig.resolve,
  test: {
    name: "evals",
    include: ["evals/**/*.eval.ts"],
    env: loadEnv("evals", process.cwd(), ""),
    reporters: ["vitest-evals/reporter"],
    testTimeout: 120_000,
    maxWorkers: 1,
  },
});
