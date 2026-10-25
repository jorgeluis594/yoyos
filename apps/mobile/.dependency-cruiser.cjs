// Enforces the dependency rules in docs/architecture.md.
// Existing violations are listed in .dependency-cruiser-known-violations.json;
// `pnpm deps:check` fails only on new ones. They are debt, not precedent: after fixing
// one, run `pnpm deps:baseline` to shrink the list, and never regenerate it to accept
// a new violation.
const TEST_FILE = "\\.(test|spec|integration)\\.tsx?$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Feature dependencies must remain acyclic.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-imports-outer-layer",
      comment: "Domain has no dependency on other feature layers.",
      severity: "error",
      from: { path: "^src/features/[^/]+/domain/", pathNot: TEST_FILE },
      to: { path: "^src/features/[^/]+/(application|infrastructure|presentation)/" },
    },
    {
      name: "application-imports-adapter",
      comment: "Application must not import concrete adapters or presentation.",
      severity: "error",
      from: { path: "^src/features/[^/]+/application/", pathNot: TEST_FILE },
      to: { path: "^src/features/[^/]+/(infrastructure|presentation)/" },
    },
    {
      name: "infrastructure-imports-presentation",
      severity: "error",
      from: { path: "^src/features/[^/]+/infrastructure/", pathNot: TEST_FILE },
      to: { path: "^src/features/[^/]+/presentation/" },
    },
    {
      name: "inner-layer-imports-package",
      comment: "Domain and application must not import frameworks, database clients or SDKs; Zod is allowed.",
      severity: "error",
      from: { path: "^src/features/[^/]+/(domain|application)/", pathNot: TEST_FILE },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-no-pkg", "npm-unknown"],
        pathNot: "(^|/)node_modules/zod/",
      },
    },
    {
      name: "inner-layer-imports-shared-contract",
      comment: "Domain and application must not depend on transport DTOs, even from shared/.",
      severity: "error",
      from: { path: "^src/features/[^/]+/(domain|application)/", pathNot: TEST_FILE },
      to: { path: "shared/contracts/" },
    },
    {
      name: "feature-imports-other-feature-internals",
      comment: "Other features are reached through their composition files; only domain and application types may be imported directly.",
      severity: "error",
      from: { path: "^src/features/([^/]+)/", pathNot: TEST_FILE },
      to: {
        path: "^src/features/([^/]+)/",
        pathNot: ["^src/features/$1/", "^src/features/[^/]+/[a-z-]*composition\\.ts$", "^src/features/[^/]+/index\\.ts$"],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "feature-imports-other-feature-adapter-type",
      comment: "Type imports from another feature come from its domain or application.",
      severity: "error",
      from: { path: "^src/features/([^/]+)/", pathNot: TEST_FILE },
      to: {
        path: "^src/features/([^/]+)/(infrastructure|presentation)/",
        pathNot: "^src/features/$1/",
        dependencyTypes: ["type-only"],
      },
    },
    {
      name: "routes-import-feature-infrastructure",
      comment: "Expo routes and generic UI reach feature adapters through composition.",
      severity: "error",
      from: { path: "^src/(app|components)/", pathNot: TEST_FILE },
      to: { path: "^src/features/[^/]+/infrastructure/" },
    },
    {
      name: "mobile-imports-core",
      comment: "Neither app imports the other's source.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^\\.\\./core/" },
    },
    {
      name: "shared-imports-app",
      comment: "Root shared/ code must not depend on an application.",
      severity: "error",
      from: { path: "^\\.\\./\\.\\./shared/" },
      to: { path: "^(src|tests|\\.\\./core)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(android|ios|\\.expo|storybook-static)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".d.ts", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
