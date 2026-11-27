import { StyleSheet, View } from "react-native";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

/** A persistent confirmation or warning inside the screen: it stays until the seller acts again, never a toast. */
export function InlineNotice({ tone, children }: { tone: "success" | "warning"; children: string | readonly string[] }) {
  const theme = useTheme();
  const lines = typeof children === "string" ? [children] : children;
  const surface = tone === "success" ? theme.successSurface : theme.warningSurface;
  const color = tone === "success" ? theme.success : theme.warning;
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: surface }]}>
    {lines.map((line) => <ThemedText key={line} type="small" style={{ color }}>{line}</ThemedText>)}
  </View>;
}

const styles = StyleSheet.create({
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"], gap: tokens.spacing["1"] },
});
