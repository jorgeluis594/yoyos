import type { StorybookConfig } from "@storybook/react-vite";
import { fileURLToPath } from "node:url";

const config: StorybookConfig = {
  stories: ["../app/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  core: {
    builder: {
      name: "@storybook/builder-vite",
      options: { viteConfigPath: fileURLToPath(new URL("./vite.config.ts", import.meta.url)) },
    },
  },
};

export default config;
