import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

// Stryker copies core into .stryker-tmp/sandbox-*, where the relative @shared and @mobile
// aliases would point outside the repository; resolve them from the real core directory.
const sandbox = fileURLToPath(new URL(".", import.meta.url));
const core = sandbox.replace(/\.stryker-tmp\/sandbox-[^/]+\/$/, "");

export default defineConfig({
  ...base,
  resolve: {
    alias: {
      ...base.resolve?.alias,
      "@mobile": `${core}../mobile/src`,
      "@shared": `${core}../../shared`,
    },
  },
  test: {
    ...base.test,
    // Only the unit project: integration and E2E tests need PostgreSQL and a server.
    projects: base.test?.projects?.filter((project) => typeof project === "object" && "test" in project && project.test?.name === "unit"),
  },
});
