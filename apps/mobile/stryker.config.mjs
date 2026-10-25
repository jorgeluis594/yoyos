import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Stryker runs Jest in a copy of mobile under .stryker-tmp/sandbox-*, where paths that
// leave mobile (the shared mapping and relative docs/design-tokens.json imports) would
// point outside the repository; map them to the real directories.
const { jest } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const shared = fileURLToPath(new URL("../../shared/", import.meta.url));
const docs = fileURLToPath(new URL("../../docs/", import.meta.url));

export default {
  plugins: ["@stryker-mutator/jest-runner"],
  testRunner: "jest",
  jest: {
    projectType: "custom",
    config: { ...jest, moduleNameMapper: { ...jest.moduleNameMapper, "^@shared/(.*)$": `${shared}$1`, "^(\\.\\./)+docs/(.*)$": `${docs}$2` } },
  },
  mutate: [
    "src/features/*/domain/**/*.ts",
    "src/features/*/application/**/*.ts",
    "!src/**/*.test.ts",
  ],
  coverageAnalysis: "perTest",
  concurrency: 2,
  ignoreStatic: true,
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  clearTextReporter: { reportTests: false },
  tempDirName: ".stryker-tmp",
};
