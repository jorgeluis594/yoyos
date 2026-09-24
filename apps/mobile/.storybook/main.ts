import type { StorybookConfig } from '@storybook/react-native-web-vite';
import { fileURLToPath } from 'node:url';
import tailwindcss from 'tailwindcss';

const config: StorybookConfig = {
  stories: ['../src/components/**/*.stories.@(ts|tsx)'],
  framework: '@storybook/react-native-web-vite',
  async viteFinal(config) {
    config.css = { ...config.css, postcss: { plugins: [tailwindcss()] } };
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      'expo-symbols': fileURLToPath(new URL('./expo-symbols.web.jsx', import.meta.url)),
    };
    return config;
  },
};

export default config;
