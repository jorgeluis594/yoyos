import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { useTheme } from '@/hooks/use-theme';

export type ButtonProps = {
  children: string;
  onPress: () => void;
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
};

export function Button({ children, onPress, variant = 'default', disabled = false, loading = false, accessibilityLabel }: ButtonProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  const foreground = variant === 'default' ? theme.primaryForeground
    : variant === 'destructive' ? theme.destructiveForeground
    : variant === 'secondary' ? theme.secondaryForeground : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: variant === 'default' ? (pressed ? theme.primaryPressed : theme.primary)
            : variant === 'destructive' ? (pressed ? theme.destructivePressed : theme.destructive)
            : variant === 'secondary' ? (pressed ? theme.accent : theme.secondary)
            : pressed ? theme.accent : 'transparent',
          borderColor: focused ? (variant === 'default' || variant === 'destructive' ? foreground : theme.ring) : 'transparent',
          opacity: blocked ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: foreground, opacity: loading ? 0 : 1 }]}>{children}</Text>
      {loading && <View pointerEvents="none" style={styles.spinner}><ActivityIndicator color={foreground} /></View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: tokens.sizing.touchTargetMinSize,
    borderRadius: tokens.radius.control,
    borderWidth: tokens.sizing.focusWidth,
    paddingHorizontal: tokens.spacing['4'],
    paddingVertical: tokens.spacing['2'],
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontFamily: tokens.typography.family,
    fontSize: tokens.typography.roles.label.size,
    lineHeight: tokens.typography.roles.label.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
  spinner: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
});
