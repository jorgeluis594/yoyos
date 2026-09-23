import { useState, type Ref } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { useTheme } from '@/hooks/use-theme';
import { useFieldContext } from './field';

export type InputProps = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  ref?: Ref<TextInput>;
};

export function Input({ invalid, disabled, style, accessibilityLabel, accessibilityHint, onFocus, onBlur, ref, ...props }: InputProps) {
  const field = useFieldContext();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const isInvalid = field?.invalid ?? invalid ?? false;
  const isDisabled = field?.disabled ?? disabled ?? false;
  const label = accessibilityLabel ?? field?.label;
  const hint = [field?.description, isInvalid && field?.error, accessibilityHint].filter(Boolean).join('. ');

  if (!field && !accessibilityLabel) throw new Error('Input requires accessibilityLabel outside Field');

  return (
    <TextInput
      {...props}
      ref={ref}
      value={props.value}
      onChangeText={props.onChangeText}
      editable={!isDisabled}
      accessibilityLabel={label ? `${label}${field?.required ? ' *' : ''}` : undefined}
      accessibilityLabelledBy={field?.label ? field.labelId : undefined}
      accessibilityHint={hint || undefined}
      accessibilityState={{ disabled: isDisabled }}
      placeholderTextColor={theme.textSecondary}
      selectionColor={theme.ring}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      style={[styles.input, field?.orientation === 'horizontal' && styles.horizontalInput, { color: isDisabled ? theme.textSecondary : theme.text, backgroundColor: theme.backgroundElement, borderColor: isInvalid ? theme.error : focused ? theme.ring : theme.input, borderWidth: focused ? tokens.sizing.focusWidth : tokens.sizing.borderWidth }, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    fontFamily: tokens.typography.family,
    minHeight: tokens.sizing.touchTargetMinSize,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.spacing['3'],
    paddingVertical: tokens.spacing['2'],
    fontSize: tokens.typography.roles.body.size,
    lineHeight: tokens.typography.roles.body.lineHeight,
  },
  horizontalInput: { flexGrow: 1, flexBasis: 160 },
});
