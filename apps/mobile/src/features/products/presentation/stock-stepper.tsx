/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

function wholeNumber(value: string): number | null {
  if (value.trim() === "") return 0;
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

export function StockStepper({ value, onChange, disabled, accessibilityLabel, decreaseLabel, increaseLabel }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  accessibilityLabel: string;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const theme = useTheme();
  const current = wholeNumber(value);
  const canDecrease = !disabled && current !== null && current > 0;
  const canIncrease = !disabled && current !== null && Number.isSafeInteger(current + 1);
  const step = (label: string, enabled: boolean, next: () => string, icon: { ios: "minus" | "plus"; android: "remove" | "add" }) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled}
      onPress={() => onChange(next())}
      style={({ pressed }) => [styles.step, { backgroundColor: pressed ? theme.accent : theme.secondary, opacity: enabled ? 1 : 0.5 }]}>
      <SymbolView name={icon} size={tokens.sizing.iconAction} tintColor={theme.secondaryForeground} />
    </Pressable>;
  return <View style={styles.row}>
    {step(decreaseLabel, canDecrease, () => String((current ?? 0) - 1), { ios: "minus", android: "remove" })}
    <Input value={value} onChangeText={onChange} keyboardType="number-pad" placeholder="0" accessibilityLabel={accessibilityLabel} style={styles.input} />
    {step(increaseLabel, canIncrease, () => String((current ?? 0) + 1), { ios: "plus", android: "add" })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", gap: tokens.spacing["1"] },
  step: { width: tokens.sizing.touchTargetMinSize, minHeight: tokens.sizing.touchTargetMinSize, borderRadius: tokens.radius.control, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minWidth: 0, textAlign: "center", paddingHorizontal: tokens.spacing["1"], fontVariant: ["tabular-nums"] },
});
