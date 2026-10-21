import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@docs": fileURLToPath(new URL("../docs", import.meta.url)),
  "@landing": fileURLToPath(new URL(".", import.meta.url)),
  "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/source/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "build-output",
          environment: "node",
          include: ["tests/build-output/*.test.ts"],
          globalSetup: ["tests/build-output/global-setup.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
