import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Unused exports are existing debt, not checked yet; list them with `pnpm knip --include exports,types`.
  exclude: ["exports", "types", "nsExports", "nsTypes", "enumMembers", "duplicates"],
  entry: [
    // Run by core/tests/e2e/mobile-order-creation.spec.ts.
    "src/**/*.integration.tsx",
    // Built by .github/workflows/whatsapp-native.yml.
    "tests/whatsapp-native-app/index.js",
  ],
  project: ["src/**/*.{ts,tsx,js,css}", "tests/**/*.{ts,tsx,js}"],
  ignoreDependencies: [
    // Tests resolve these from the package that ships them, not from mobile.
    "canvaskit-wasm",
    "@better-fetch/fetch",
    // The Expo plugin assumes it from app.json; the app does not use updates.
    "expo-updates",
    // Native module of expo-router, listed so Expo autolinking includes it.
    "expo-glass-effect",
    // babel-preset-expo loads it by name; listed so pnpm can resolve it.
    "@babel/plugin-transform-react-jsx",
  ],
};

export default config;
