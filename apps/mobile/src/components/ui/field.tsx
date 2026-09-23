import { createContext, isValidElement, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextProps, type ViewProps } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { useTheme } from '@/hooks/use-theme';

type FieldContextValue = {
  invalid: boolean;
  disabled: boolean;
  required: boolean;
  orientation: 'vertical' | 'horizontal';
  labelId: string;
  descriptionId: string;
  errorId: string;
  label: string;
  description: string;
  error: string;
  setLabel: (value: string) => void;
  setDescription: (value: string) => void;
  setError: (value: string) => void;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext() {
  return useContext(FieldContext);
}

function contentText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(contentText).filter(Boolean).join(' ');
  if (isValidElement<{ children?: ReactNode }>(children)) return contentText(children.props.children);
  return '';
}

type ContainerProps = ViewProps & { className?: string };

export function FieldGroup({ style, ...props }: ContainerProps) {
  return <View style={[styles.group, style]} {...props} />;
}

type FieldProps = ContainerProps & {
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  orientation?: 'vertical' | 'horizontal';
};

export function Field({
  invalid = false,
  disabled = false,
  required = false,
  orientation = 'vertical',
  style,
  ...props
}: FieldProps) {
  const id = useId();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  return (
    <FieldContext.Provider value={{
      invalid, disabled, required, orientation, labelId: `${id}-label`, descriptionId: `${id}-description`,
      errorId: `${id}-error`, label, description, error, setLabel, setDescription, setError,
    }}>
      <View style={[styles.field, orientation === 'horizontal' && styles.horizontal, style]} {...props} />
    </FieldContext.Provider>
  );
}

function useRegisteredText(children: ReactNode, register?: (value: string) => void) {
  const value = contentText(children);
  useEffect(() => {
    register?.(value);
    return () => register?.('');
  }, [register, value]);
}

type PieceProps = TextProps & { className?: string };

export function FieldLabel({ children, style, ...props }: PieceProps) {
  const field = useFieldContext();
  const theme = useTheme();
  useRegisteredText(children, field?.setLabel);
  return (
    <Text nativeID={field?.labelId} style={[styles.label, { color: field?.disabled ? theme.textSecondary : theme.text }, field?.orientation === 'horizontal' && styles.horizontalLabel, style]} {...props}>
      {children}{field?.required ? <Text style={{ color: theme.ring }}> *</Text> : null}
    </Text>
  );
}

export function FieldDescription({ children, style, ...props }: PieceProps) {
  const field = useFieldContext();
  const theme = useTheme();
  useRegisteredText(children, field?.setDescription);
  return <Text nativeID={field?.descriptionId} style={[styles.supporting, { color: theme.textSecondary }, field?.orientation === 'horizontal' && styles.horizontalSupporting, style]} {...props}>{children}</Text>;
}

export function FieldError({ children, style, ...props }: PieceProps) {
  const field = useFieldContext();
  const theme = useTheme();
  useRegisteredText(children, field?.setError);
  return <Text nativeID={field?.errorId} accessibilityLiveRegion="polite" style={[styles.supporting, { color: theme.error }, field?.orientation === 'horizontal' && styles.horizontalSupporting, style]} {...props}>{children}</Text>;
}

const styles = StyleSheet.create({
  group: { gap: tokens.layout.fieldGap },
  field: { gap: tokens.layout.labelGap },
  horizontal: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  horizontalLabel: { flexBasis: 100 },
  horizontalSupporting: { width: '100%' },
  label: { fontFamily: tokens.typography.family, fontSize: tokens.typography.roles.label.size, lineHeight: tokens.typography.roles.label.lineHeight, fontWeight: '500' },
  supporting: { fontFamily: tokens.typography.family, fontSize: tokens.typography.roles['body-compact'].size, lineHeight: tokens.typography.roles['body-compact'].lineHeight },
});
