import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { fileAndShellEnv } from "./evals/lib/eval-env.js";
import testConfig from "./vitest.config.js";

// AI evals call real models and cost money, so they run only through `pnpm eval`, never in CI.
export default defineConfig({
  resolve: testConfig.resolve,
  test: {
    name: "evals",
    include: ["evals/**/*.eval.ts"],
    // `EVAL_PAID` is never read from `.env`: the workers inherit it from the shell.
    env: fileAndShellEnv(loadEnv("evals", process.cwd(), ""), {}) as Record<string, string>,
    reporters: ["vitest-evals/reporter"],
    globalSetup: ["./evals/global-setup.ts"],
    testTimeout: 180_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
