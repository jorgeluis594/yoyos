import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OrderDraft } from "@mobile/features/orders/domain/order-draft";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

type Item = OrderDraft["items"][number];
type Props = { items: readonly Item[]; total: string | null; format: (amount: number, currency: string) => string; onEdit?: () => void };

export function OrderItemsCard({ items, total, format, onEdit }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const units = items.reduce((count, item) => count + item.quantity, 0);
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <View style={styles.header}>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('items')}</ThemedText>
      {onEdit ? <Button variant="ghost" accessibilityLabel={t('changeItems')} onPress={onEdit}>{t('editShort')}</Button> : null}
    </View>
    {items.map((item, index) => <View key={item.variantId} style={styles.item}
      accessible accessibilityLabel={t('orderItemLabel', { name: item.productName, quantity: item.quantity, total: format(item.shownUnitPrice.amount * item.quantity, item.shownUnitPrice.currency) })}>
      <View style={[styles.thumb, { backgroundColor: theme.secondary }]}>
        <ThemedText type="subtitle" themeColor="textSecondary">{item.productName.trim().charAt(0).toUpperCase()}</ThemedText>
        <View style={[styles.badge, { backgroundColor: theme.text, borderColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={[styles.badgeText, { color: theme.backgroundElement }]}>{item.quantity}</ThemedText>
        </View>
      </View>
      <View style={[styles.itemBody, index > 0 && { borderTopWidth: tokens.sizing.borderWidth, borderColor: theme.border }]}>
        <View style={styles.flex}>
          <ThemedText style={styles.name}>{item.productName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ") || item.sku}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.number}>{item.quantity} × {format(item.shownUnitPrice.amount, item.shownUnitPrice.currency)}</ThemedText>
        </View>
        <ThemedText style={[styles.number, styles.lineTotal]}>{format(item.shownUnitPrice.amount * item.quantity, item.shownUnitPrice.currency)}</ThemedText>
      </View>
    </View>)}
    <View style={[styles.footer, { borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>{t('unitsReferential', { count: units })}</ThemedText>
      {total ? <ThemedText style={[styles.number, styles.lineTotal]}>{total}</ThemedText> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 4, paddingTop: 4 },
  flex: { flex: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 16 },
  thumb: { width: 44, height: 44, borderRadius: tokens.radius.control, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -6, right: -6, minWidth: 22, height: 22, borderRadius: 11, borderWidth: 2, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 12, lineHeight: 14 },
  itemBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingRight: 16 },
  name: { fontWeight: 600 },
  number: { fontVariant: ["tabular-nums"] },
  lineTotal: { fontWeight: 500, textAlign: "right" },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: tokens.sizing.borderWidth, paddingHorizontal: 16, paddingVertical: 12 },
});
