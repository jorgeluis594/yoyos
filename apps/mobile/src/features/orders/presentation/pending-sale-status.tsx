import { StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";

type Props = Readonly<{ title: string; description: string; actionLabel: string; checking: boolean; disabled: boolean; onCheck: () => void }>;

export function PendingSaleStatus({ title, description, actionLabel, checking, disabled, onCheck }: Props) {
  const theme = useTheme();
  return <View testID="pending-sale-status" style={[styles.root, { backgroundColor: theme.warningSurface, borderColor: theme.warning }]}>
    <View style={styles.heading}>
      <SymbolView name={{ ios: "exclamationmark.triangle.fill", android: "warning" }} size={20} tintColor={theme.warning} />
      <ThemedText type="smallBold" accessibilityRole="header" style={[styles.title, { color: theme.warning }]}>{title}</ThemedText>
    </View>
    <ThemedText type="small" accessibilityLiveRegion="polite">{description}</ThemedText>
    <View style={styles.action}><Button variant="secondary" loading={checking} disabled={disabled} onPress={onCheck}>{actionLabel}</Button></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1 },
  action: { alignSelf: "flex-start", marginTop: 4 },
});
