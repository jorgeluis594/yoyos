import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { StatusPill } from "@mobile/features/orders/presentation/order-payment-parts";
import { deliveryStatusLabel, orderLanguage } from "@mobile/features/orders/presentation/order-labels";
import { useTheme } from "@mobile/hooks/use-theme";
import { getPeruDistrict, getPeruProvince } from "@shared/peru-geography";
import tokens from "../../../../../../docs/design-tokens.json";

type Symbol = Readonly<{ ios: string; android: string }>;
type DeliveryStatus = "pending" | "shipped" | "delivered";
type Language = ReturnType<typeof orderLanguage>;

export const deliveryRowSymbols = {
  status: { ios: "shippingbox", android: "local_shipping" },
  dispatch: { ios: "calendar", android: "calendar_today" },
  shipping: { ios: "mappin.and.ellipse", android: "location_on" },
  label: { ios: "printer", android: "print" },
} as const satisfies Record<string, Symbol>;

/** Delivery state at a glance, in the seller's order language. */
export function DeliveryBadge({ status, language }: { status: DeliveryStatus; language: Language }) {
  return <StatusPill label={deliveryStatusLabel(status, language)} tone={status === "delivered" ? "success" : "neutral"}
    symbol={status === "delivered" ? { ios: "checkmark.circle", android: "check_circle" } : status === "shipped" ? { ios: "shippingbox", android: "local_shipping" } : { ios: "clock", android: "schedule" }} />;
}

/** Aligned row: icon tile, small label above the current value, chevron. */
export function DeliveryRow({ symbol, label, value, onPress, disabled = false, expanded, muted = false }: {
  symbol: Symbol; label: string; value: string; onPress?: () => void; disabled?: boolean; expanded?: boolean; muted?: boolean;
}) {
  const theme = useTheme();
  const content = <>
    <View style={[styles.tile, { backgroundColor: theme.secondary }]}>
      <SymbolView name={symbol as never} size={20} tintColor={theme.text} />
    </View>
    <View style={styles.flex}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{label}</ThemedText>
      <ThemedText themeColor={muted ? "textSecondary" : "text"} style={styles.value} numberOfLines={2}>{value}</ThemedText>
    </View>
    {onPress ? <SymbolView name={expanded ? { ios: "chevron.down", android: "expand_more" } : { ios: "chevron.right", android: "chevron_right" }} size={20} tintColor={theme.textSecondary} /> : null}
  </>;
  // A row that does nothing is plain information: no chevron, normal contrast.
  if (!onPress) return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.row}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : "transparent", opacity: disabled ? 0.5 : 1 }]}>
    {content}
  </Pressable>;
}

type ShippingChoice =
  | Readonly<{ method: "home" | "agency"; districtCode: string }>
  | Readonly<{ method: "store" }>
  | Readonly<{ method: "home" | "agency"; district: string; province?: string }>;

/** One-line shipping summary shared by the new sale and the order detail. */
export function useShippingSummary() {
  const { t } = useTranslation();
  return (choice: ShippingChoice | null) => {
    if (!choice) return t('shippingEmpty');
    if (choice.method === "store") return t('shippingSummaryStore');
    const code = "districtCode" in choice ? getPeruDistrict(choice.districtCode) : null;
    const district = "district" in choice ? choice.district : code?.name ?? "";
    const province = "province" in choice ? choice.province : code ? getPeruProvince(code.provinceCode)?.name : undefined;
    if (choice.method === "home") return district ? t('shippingSummaryHome', { district }) : t('shippingSummaryHomeShort');
    return [t('shippingSummaryAgency'), [district, province].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  };
}

/** Floating sheet that picks one value; used where a row opens a short list of states. */
export function OptionSheet<Value extends string>({ visible, title, options, value, onSelect, onClose }: {
  visible: boolean; title: string; options: readonly Readonly<{ value: Value; label: string }>[]; value: Value; onSelect: (value: Value) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.flex}>
      <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel={t('detailClose')} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={[styles.grab, { backgroundColor: theme.input }]} />
        <View style={styles.sheetHeader}>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{title}</ThemedText>
          <Button variant="ghost" onPress={onClose}>{t('detailClose')}</Button>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.options}>
          {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === value }}
            onPress={() => { onSelect(option.value); onClose(); }}
            style={[styles.option, { borderColor: option.value === value ? theme.primary : theme.border }]}>
            <View style={[styles.radio, { borderColor: option.value === value ? theme.primary : theme.input }]}>
              {option.value === value ? <View style={[styles.dot, { backgroundColor: theme.primary }]} /> : null}
            </View>
            <ThemedText style={styles.flex}>{option.label}</ThemedText>
          </Pressable>)}
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 8, borderRadius: 6 },
  tile: { width: 40, height: 40, borderRadius: tokens.radius.control, alignItems: "center", justifyContent: "center" },
  value: { fontWeight: 500 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderTopWidth: tokens.sizing.borderWidth },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  options: { gap: 12, padding: 16 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: tokens.radius.card, padding: 16, minHeight: 56 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
