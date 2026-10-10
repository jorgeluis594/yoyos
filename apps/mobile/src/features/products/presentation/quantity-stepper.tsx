/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

function wholeNumber(value: string, min: number): number | null {
  if (value.trim() === "") return min;
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

/** Whole-number field with minus/plus buttons; typing stays possible and validation belongs to the caller. */
export function QuantityStepper({ value, onChange, disabled, min = 0, max = Number.MAX_SAFE_INTEGER, accessibilityLabel, decreaseLabel, increaseLabel }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  accessibilityLabel: string;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const theme = useTheme();
  const current = wholeNumber(value, min);
  const canDecrease = !disabled && current !== null && current > min;
  const canIncrease = !disabled && current !== null && current < max;
  const step = (label: string, enabled: boolean, next: () => string, icon: { ios: "minus" | "plus"; android: "remove" | "add" }) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled}
      onPress={() => onChange(next())}
      style={({ pressed }) => [styles.step, { backgroundColor: pressed ? theme.accent : theme.secondary, opacity: enabled ? 1 : 0.5 }]}>
      <SymbolView name={icon} size={tokens.sizing.iconAction} tintColor={theme.secondaryForeground} />
    </Pressable>;
  return <View style={styles.row}>
    {step(decreaseLabel, canDecrease, () => String((current ?? min) - 1), { ios: "minus", android: "remove" })}
    <Input value={value} onChangeText={onChange} keyboardType="number-pad" placeholder={String(min)} accessibilityLabel={accessibilityLabel} style={styles.input} />
    {step(increaseLabel, canIncrease, () => String((current ?? min) + 1), { ios: "plus", android: "add" })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", gap: tokens.spacing["1"] },
  step: { width: tokens.sizing.touchTargetMinSize, minHeight: tokens.sizing.touchTargetMinSize, borderRadius: tokens.radius.control, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minWidth: 0, textAlign: "center", paddingHorizontal: tokens.spacing["1"], fontVariant: ["tabular-nums"] },
});
