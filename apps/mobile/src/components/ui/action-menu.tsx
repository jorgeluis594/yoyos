import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import tokens from '../../../../../docs/design-tokens.json';
import { useTheme } from '@/hooks/use-theme';

export type ActionMenuAction = {
  id: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
};

export type ActionMenuProps = { actions: ActionMenuAction[] };

export function ActionMenu({ actions }: ActionMenuProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const menuActions: MenuAction[] = actions.map(({ id, label, destructive }) => ({
    id,
    title: label,
    ...(destructive ? { attributes: { destructive: true } } : {}),
  }));

  return (
    <MenuView
      actions={menuActions}
      onPressAction={({ nativeEvent }) => actions.find(({ id }) => id === nativeEvent.event)?.onSelect()}
    >
      <View accessible accessibilityLabel={t('moreActions')} accessibilityRole="button" style={[styles.trigger, { backgroundColor: 'transparent' }]}>
        <Text style={[styles.label, { color: theme.text }]} accessibilityElementsHidden importantForAccessibility="no">•••</Text>
      </View>
    </MenuView>
  );
}

const styles = StyleSheet.create({
  trigger: { minWidth: tokens.sizing.touchTargetMinSize, minHeight: tokens.sizing.touchTargetMinSize, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.avatar },
  label: { fontSize: tokens.sizing.iconAction, lineHeight: tokens.sizing.iconAction, fontWeight: '600' },
});
