import type { KnipConfig } from "knip";

// Turns CSS @import rules into imports so packages used only from CSS count as used.
const cssImports = (text: string) =>
  [...text.matchAll(/@import\s+["']([^"']+)["']/g)].map(([, specifier]) => `import "${specifier}";`).join("\n");

const config: KnipConfig = {
  // Unused exports are existing debt, not checked yet; list them with `pnpm knip --include exports,types`.
  exclude: ["exports", "types", "nsExports", "nsTypes", "enumMembers", "duplicates"],
  entry: [
    "scripts/*.ts",
    "tests/e2e/server.ts",
    "src/**/type-contracts.ts",
    "src/shared/images/infrastructure/qr-fixtures/generate-fixtures.mjs",
  ],
  project: ["app/**/*.{ts,tsx,css}", "src/**/*.{ts,tsx,mjs,css}", "scripts/**/*.ts", "tests/**/*.ts", "prisma/**/*.prisma"],
  compilers: { css: cssImports },
  ignoreBinaries: ["psql"],
  // Storybook resolves its builder by name from @storybook/react-vite.
  ignoreDependencies: ["@storybook/builder-vite"],
  ignoreIssues: {
    // shadcn components export their variants and parts by convention.
    "app/components/ui/**": ["exports"],
  },
};

export default config;
