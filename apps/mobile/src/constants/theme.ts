/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';
import tokens from '../../../../docs/design-tokens.json';

export const Colors = {
  light: {
    text: tokens.colors.light.foreground,
    background: tokens.colors.light.background,
    backgroundElement: tokens.colors.light.card,
    backgroundSelected: tokens.colors.light.accent,
    textSecondary: tokens.colors.light['muted-foreground'],
    input: tokens.colors.light.input,
    ring: tokens.colors.light.ring,
    error: tokens.colors.light.error,
  },
  dark: {
    text: tokens.colors.dark.foreground,
    background: tokens.colors.dark.background,
    backgroundElement: tokens.colors.dark.card,
    backgroundSelected: tokens.colors.dark.accent,
    textSecondary: tokens.colors.dark['muted-foreground'],
    input: tokens.colors.dark.input,
    ring: tokens.colors.dark.ring,
    error: tokens.colors.dark.error,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
