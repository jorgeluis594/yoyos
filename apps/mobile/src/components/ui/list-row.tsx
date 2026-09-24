import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type ListRowProps = {
  title: string;
  description?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress: () => void;
};

export function ListRow({ title, description, leading, trailing, onPress }: ListRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}
    >
      {leading}
      <View style={styles.content}>
        <ThemedText>{title}</ThemedText>
        {description ? <ThemedText type="small" themeColor="textSecondary">{description}</ThemedText> : null}
      </View>
      {trailing ?? <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: tokens.sizing.listRowMobileMinHeight, paddingHorizontal: tokens.spacing['4'], paddingVertical: tokens.spacing['2'], flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['3'] },
  content: { flex: 1, minWidth: 0 },
  chevron: { fontSize: tokens.sizing.iconNavigation, lineHeight: tokens.sizing.iconNavigation },
});
