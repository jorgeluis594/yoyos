import { StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";

/** A state mark: icon and text, never color alone. It is read as part of its item, so it is not focusable on its own. */
export function DoubtBadge({ label }: Readonly<{ label?: string }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  return <View style={[styles.badge, { backgroundColor: theme.warningSurface }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    <SymbolView name={{ ios: "exclamationmark.triangle", android: "warning" }} size={16} tintColor={theme.warning} />
    <ThemedText type="small" style={[styles.text, { color: theme.warning }]}>{label ?? t("orderReview.doubtBadge")}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  text: { fontWeight: "600" },
});
