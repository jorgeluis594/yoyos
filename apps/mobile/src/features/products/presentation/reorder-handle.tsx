/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { Alert, Pressable, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

/**
 * The handle that moves an option or a value. Tapping opens Subir / Bajar / Cancelar, and screen readers get the same two
 * moves as actions of the handle. Subir is absent on the first item and Bajar on the last.
 */
export function ReorderHandle({ name, position, total, onMove, disabled = false }: {
  name: string;
  /** 1-based. */
  position: number;
  total: number;
  onMove: (to: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const up = position > 1;
  const down = position < total;
  const moves = [
    ...(up ? [{ name: "moveUp", label: t("moveUp"), to: position - 2 }] : []),
    ...(down ? [{ name: "moveDown", label: t("moveDown"), to: position }] : []),
  ];
  const open = () => Alert.alert(t("moveItem", { name }), undefined, [
    ...moves.map((move) => ({ text: move.label, onPress: () => onMove(move.to) })),
    { text: t("cancel"), style: "cancel" as const },
  ]);
  return <Pressable
    accessibilityRole="button" accessibilityLabel={t("moveHandle", { name, position, total })} accessibilityState={{ disabled: disabled || total < 2 }}
    accessibilityActions={moves.map(({ name: action, label }) => ({ name: action, label }))}
    onAccessibilityAction={({ nativeEvent }) => moves.find((move) => move.name === nativeEvent.actionName) && onMove(moves.find((move) => move.name === nativeEvent.actionName)!.to)}
    disabled={disabled || total < 2} onPress={open}
    style={({ pressed }) => [styles.handle, { backgroundColor: pressed ? theme.accent : "transparent", opacity: disabled || total < 2 ? 0.4 : 1 }]}>
    <SymbolView name={{ ios: "line.3.horizontal", android: "drag_indicator" }} size={tokens.sizing.iconAction} tintColor={theme.textSecondary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  handle: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, borderRadius: tokens.sizing.touchTargetMinSize / 2, alignItems: "center", justifyContent: "center" },
});
