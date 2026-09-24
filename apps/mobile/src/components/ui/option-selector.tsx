import { Host, Picker } from '@expo/ui';
import { StyleSheet, View } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
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
  const disabled = field?.disabled ?? false;
  const invalid = field?.invalid ?? false;
  const hint = [field?.description, invalid && field?.error].filter(Boolean).join('. ');

  // ponytail: Expo Picker has no per-option disabled state; omit disabled choices until its API supports one.
  const available = options.flatMap((option, index) => option.disabled ? [] : [{ option, index }]);
  const selectedIndex = value === null ? -1 : options.findIndex((option) => option.value === value && !option.disabled);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={field?.label} accessibilityLabelledBy={field?.label ? field.labelId : undefined} accessibilityHint={hint || undefined} accessibilityState={{ disabled }}>
      <Host style={styles.host}>
        <Picker
          testID={testID}
          selectedValue={selectedIndex}
          onValueChange={(index) => onValueChange(index < 0 ? null : options[index].value)}
          enabled={!disabled}
        >
          <Picker.Item label={placeholder} value={-1} />
          {available.map(({ option, index }) => <Picker.Item key={option.value} label={option.description ? `${option.label} — ${option.description}` : option.label} value={index} />)}
        </Picker>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { minHeight: tokens.sizing.touchTargetMinSize },
});
