import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { maxOrderLineQuantity } from "@shared/orders-edit";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import { QuantityStepper } from "@mobile/features/products/presentation/quantity-stepper";
import tokens from "../../../../../../docs/design-tokens.json";

type OrderItem = OrderAggregateResponse["items"][number];

/** The seller's edit of the items: the lines as loaded, the base revision they were loaded with, the typed quantities and the removed lines. */
export type ItemsDraft = Readonly<{ base: string; items: readonly OrderItem[]; quantities: Readonly<Record<string, string>>; removed: ReadonlySet<string> }>;
export type ItemsLine = Readonly<{ variantId: string; quantity: number }>;

/** Pins the loaded lines and revision. */
export function startItemsDraft(order: OrderAggregateResponse): ItemsDraft {
  return { base: order.revisions.items, items: order.items, quantities: Object.fromEntries(order.items.map((item) => [item.id, String(item.quantity)])), removed: new Set() };
}

export const remainingItems = (draft: ItemsDraft) => draft.items.filter((item) => !draft.removed.has(item.id));

/** The typed quantity as a whole number from 1 to 9999, or null. */
export function typedQuantity(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 1 && value <= maxOrderLineQuantity ? value : null;
}

export const hasInvalidQuantity = (draft: ItemsDraft) => remainingItems(draft).some((item) => typedQuantity(draft.quantities[item.id] ?? "") === null);

/** The final lines to save, or null while a quantity is invalid or no line is left. */
export function draftLines(draft: ItemsDraft): ItemsLine[] | null {
  const lines = remainingItems(draft).map((item) => ({ variantId: item.variantId, quantity: typedQuantity(draft.quantities[item.id] ?? "") }));
  return lines.length > 0 && lines.every((line): line is ItemsLine => line.quantity !== null) ? lines : null;
}

export const isDraftDirty = (draft: ItemsDraft) => draft.removed.size > 0 || draft.items.some((item) => !draft.removed.has(item.id) && (draft.quantities[item.id] ?? "") !== String(item.quantity));

/** What a lost answer left behind, read from the order: the sent lines are saved, nothing changed, or somebody else changed the items. */
export function reconcileLostSave(sent: readonly ItemsLine[], base: string, reread: OrderAggregateResponse): "saved" | "unchanged" | "changed" {
  const stored = new Map(reread.items.map((item) => [item.variantId, item.quantity]));
  if (stored.size === sent.length && sent.every((line) => stored.get(line.variantId) === line.quantity)) return "saved";
  return reread.revisions.items === base ? "unchanged" : "changed";
}

const variantOf = (item: OrderItem) => Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ");

type Props = { draft: ItemsDraft; onChange: (draft: ItemsDraft) => void; disabled: boolean; format: (amount: number, currency: string) => string };

/** Edit-mode rows: a quantity control and **Quitar** per item. Adding products and changing variants are not offered on mobile. */
export function OrderItemsEditor({ draft, onChange, disabled, format }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const remaining = remainingItems(draft);
  const lastItem = remaining.length === 1;
  return <View>
    {remaining.map((item, index) => {
      const text = draft.quantities[item.id] ?? "";
      const quantity = typedQuantity(text);
      const variant = variantOf(item);
      return <View key={item.id} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
        <View style={styles.identity}>
          <ThemedText style={styles.name}>{item.productName}</ThemedText>
          {variant ? <ThemedText type="small" themeColor="textSecondary">{variant}</ThemedText> : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.number}>
            {quantity ?? "—"} × {format(item.unitPrice.amount, item.unitPrice.currency)}{quantity ? ` = ${format(item.unitPrice.amount * quantity, item.unitPrice.currency)}` : ""}
          </ThemedText>
        </View>
        <QuantityStepper value={text} min={1} max={maxOrderLineQuantity} disabled={disabled}
          onChange={(next) => onChange({ ...draft, quantities: { ...draft.quantities, [item.id]: next } })}
          accessibilityLabel={t("itemsEdit.quantity", { name: item.productName })} decreaseLabel={t("itemsEdit.decrease", { name: item.productName })} increaseLabel={t("itemsEdit.increase", { name: item.productName })} />
        {quantity === null ? <ThemedText type="small" style={{ color: theme.error }} accessibilityRole="alert">{t("itemsEdit.quantityInvalid")}</ThemedText> : null}
        <Button variant="ghost" accessibilityLabel={t("itemsEdit.removeLabel", { name: item.productName })} accessibilityHint={lastItem ? t("itemsEdit.lastItem") : undefined} disabled={disabled || lastItem}
          onPress={() => onChange({ ...draft, removed: new Set([...draft.removed, item.id]) })}>{t("itemsEdit.remove")}</Button>
      </View>;
    })}
    {lastItem ? <ThemedText type="small" themeColor="textSecondary" style={styles.lastItem}>{t("itemsEdit.lastItem")}</ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { gap: tokens.spacing["2"], paddingVertical: tokens.spacing["3"] },
  identity: { gap: 2 },
  name: { fontWeight: 600 },
  number: { fontVariant: ["tabular-nums"] },
  lastItem: { paddingBottom: tokens.spacing["2"] },
});
