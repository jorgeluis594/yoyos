import { Host, Picker } from '@expo/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { useTheme } from '@/hooks/use-theme';
import { useFieldContext } from './field';

export type OptionSelectorOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type OptionSelectorProps = {
  options: OptionSelectorOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  testID?: string;
};

export function OptionSelector({ options, value, onValueChange, placeholder = 'Selecciona una opción', testID }: OptionSelectorProps) {
  const field = useFieldContext();
  const theme = useTheme();
  const disabled = field?.disabled ?? false;
  const invalid = field?.invalid ?? false;
  const hint = [field?.description, invalid && field?.error].filter(Boolean).join('. ');

  if (options.length > 4) {
    // ponytail: Expo Picker has no per-option disabled state; omit disabled choices until its API supports one.
    const available = options.flatMap((option, index) => option.disabled ? [] : [{ option, index }]);
    const selectedIndex = value === null ? -1 : options.findIndex((option) => option.value === value && !option.disabled);
    return (
      <Host style={styles.host}>
        <View accessibilityRole="radiogroup" accessibilityLabel={field?.label} accessibilityLabelledBy={field?.label ? field.labelId : undefined} accessibilityHint={hint || undefined} accessibilityState={{ disabled }}>
          <Picker
            testID={testID}
            selectedValue={selectedIndex}
            onValueChange={(index) => onValueChange(index < 0 ? null : options[index].value)}
            enabled={!disabled}
          >
            <Picker.Item label={placeholder} value={-1} />
            {available.map(({ option, index }) => <Picker.Item key={option.value} label={option.label} value={index} />)}
          </Picker>
        </View>
      </Host>
    );
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={field?.label} accessibilityLabelledBy={field?.label ? field.labelId : undefined} accessibilityHint={hint || undefined} accessibilityState={{ disabled }} testID={testID}>
      {options.map((option) => {
        const selected = value === option.value;
        const unavailable = disabled || option.disabled === true;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityHint={option.description}
            accessibilityState={{ checked: selected, disabled: unavailable }}
            disabled={unavailable}
            onPress={() => onValueChange(option.value)}
            style={[styles.row, { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement, borderColor: invalid ? theme.error : selected ? theme.ring : theme.input }, unavailable && styles.disabled]}
          >
            <View style={[styles.indicator, { borderColor: selected ? theme.ring : theme.input }]}>
              {selected && <View style={[styles.dot, { backgroundColor: theme.ring }]} />}
            </View>
            <View style={styles.copy}>
              <Text style={[styles.label, { color: unavailable ? theme.textSecondary : theme.text }]}>{option.label}</Text>
              {option.description && <Text style={[styles.description, { color: theme.textSecondary }]}>{option.description}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { minHeight: tokens.sizing.touchTargetMinSize },
  row: { minHeight: tokens.sizing.touchTargetMinSize, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['3'], borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.control, paddingHorizontal: tokens.spacing['4'], paddingVertical: tokens.spacing['2'] },
  indicator: { width: 20, height: 20, borderRadius: 10, borderWidth: tokens.sizing.borderWidth, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  copy: { flex: 1, gap: tokens.spacing['1'] },
  label: { fontFamily: tokens.typography.family, fontSize: tokens.typography.roles.label.size, lineHeight: tokens.typography.roles.label.lineHeight },
  description: { fontFamily: tokens.typography.family, fontSize: tokens.typography.roles['body-compact'].size, lineHeight: tokens.typography.roles['body-compact'].lineHeight },
  disabled: { opacity: 0.55 },
});
