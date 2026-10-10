/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

/** Product screens hide the tab bar, so this bar is their way out in every state. */
export function ProductTopBar({ title, onClose, closeDisabled = false, children }: {
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return <View style={[styles.bar, { borderBottomColor: theme.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('close')} accessibilityState={{ disabled: closeDisabled }} disabled={closeDisabled}
      onPress={onClose} style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? theme.accent : "transparent", opacity: closeDisabled ? 0.5 : 1 }]}>
      <SymbolView name={{ ios: "xmark", android: "close" }} size={tokens.sizing.iconNavigation} tintColor={theme.text} />
    </Pressable>
    <ThemedText type="subtitle" accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</ThemedText>
    {children ? <View style={styles.actions}>{children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  bar: { minHeight: tokens.layout.appHeaderMinHeight, flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"], paddingLeft: tokens.spacing["1"], paddingRight: tokens.spacing["4"], paddingVertical: tokens.spacing["1"], borderBottomWidth: tokens.sizing.borderWidth },
  iconAction: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, borderRadius: tokens.sizing.touchTargetMinSize / 2, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, minWidth: 0 },
  actions: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: tokens.spacing["1"] },
});
