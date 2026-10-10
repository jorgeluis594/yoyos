import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { interStyle } from '@mobile/constants/typography';
import { useTheme } from '@mobile/hooks/use-theme';
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

export function OptionSelector({ options, value, onValueChange, placeholder, testID }: OptionSelectorProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const field = useFieldContext();
  const disabled = field?.disabled ?? false;
  const invalid = field?.invalid ?? false;
  const hint = [field?.description, invalid && field?.error].filter(Boolean).join('. ');
  const selected = options.find(option => option.value === value && !option.disabled);
  const label = selected ? selected.description ? `${selected.label} — ${selected.description}` : selected.label : placeholder ?? t('selectOption');
  const actions: MenuAction[] = [{ id: '-1', title: placeholder ?? t('selectOption') }, ...options.flatMap((option, index) => option.disabled ? [] : [{ id: String(index), title: option.description ? `${option.label} — ${option.description}` : option.label }])];

  const control = (
    <View testID={testID} accessible accessibilityRole="button" accessibilityLabel={field?.label ? `${field.label}: ${label}` : label}
      accessibilityLabelledBy={field?.label ? field.labelId : undefined} accessibilityHint={hint || undefined} accessibilityState={{ disabled }}
      style={[styles.control, { backgroundColor: disabled ? theme.secondary : theme.backgroundElement, borderColor: invalid ? theme.error : theme.input, borderWidth: tokens.sizing.borderWidth }]}>
      <Text numberOfLines={1} style={[styles.label, { color: disabled || !selected ? theme.textSecondary : theme.text }]}>{label}</Text>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more' }} size={tokens.sizing.iconAction} tintColor={theme.textSecondary} />
    </View>
  );

  return disabled ? control : (
    <MenuView actions={actions} onPressAction={({ nativeEvent }) => onValueChange(nativeEvent.event === '-1' ? null : options[Number(nativeEvent.event)].value)}>
      {control}
    </MenuView>
  );
}

const styles = StyleSheet.create({
  control: { minHeight: tokens.sizing.touchTargetMinSize, borderRadius: tokens.radius.control, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['2'], paddingHorizontal: tokens.spacing['3'], paddingVertical: tokens.spacing['2'] },
  label: { ...interStyle(), flex: 1, fontSize: tokens.typography.roles.body.size, lineHeight: tokens.typography.roles.body.lineHeight },
});
