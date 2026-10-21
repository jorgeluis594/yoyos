import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: ["dist/**", ".astro/**", "node_modules/**", "tests/build-output/.dist/**"],
  },
  {
    files: ["**/*.{js,ts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  ...astro.configs.recommended,
  ...astro.configs["jsx-a11y-strict"],
]);
