import type { OrderAggregateResponse } from "@shared/contracts/orders";

type Item = OrderAggregateResponse["items"][number];
export type ShortStockLine = Readonly<{ variantId: string; label: string; quantity: number; available: number }>;

/** Product name followed by its combination in the mobile format, «Camisa (Talla: M · Color: Azul)»; just the name without options. */
export const stockItemLabel = (item: Pick<Item, "productName" | "variantAttributes">) => {
  const variant = Object.entries(item.variantAttributes).map(([key, value]) => `${key}: ${value}`).join(" · ");
  return variant ? `${item.productName} (${variant})` : item.productName;
};

/** An order waiting for stock: not deducted yet, or deducted with units an edit added that did not fit. */
type StockDue = NonNullable<OrderAggregateResponse["stockDue"]>;
export const isWaitingDue = (stockDue: OrderAggregateResponse["stockDue"]): stockDue is Exclude<StockDue, { kind: "deducting" }> => stockDue?.kind === "waiting" || stockDue?.kind === "partial_waiting";

/** The short items of a waiting order, in the order of the products card; each variant appears once. */
export function shortStockLines(order: Pick<OrderAggregateResponse, "items" | "stockDue">): readonly ShortStockLine[] {
  const due = order.stockDue;
  if (!isWaitingDue(due)) return [];
  const available = new Map(due.shortItems.map(item => [item.variantId, item.available]));
  return order.items.flatMap(item => available.has(item.variantId)
    ? [{ variantId: item.variantId, label: stockItemLabel(item), quantity: item.quantity, available: available.get(item.variantId)! }] : []);
}

/** «A», «A y B», «A, B y C»; the connector is the translated «y». */
export const joinLabels = (labels: readonly string[], and: string) =>
  labels.length < 2 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} ${and} ${labels[labels.length - 1]}`;
