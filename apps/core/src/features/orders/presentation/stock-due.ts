import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { orderFulfillmentBlock } from "@shared/orders-fulfillment";

type Item = Pick<OrderAggregateResponse["items"][number], "variantId" | "productName" | "variantAttributes" | "quantity">;
type StockOrder = Readonly<{ items: readonly Item[]; stockDue: OrderAggregateResponse["stockDue"] }>;

/** «Camisa (M · Azul)»: the product with its combination, or just the name for a product without options. */
export function stockItemName(item: Pick<Item, "productName" | "variantAttributes">) {
  const combination = Object.values(item.variantAttributes).join(" · ");
  return combination ? `${item.productName} (${combination})` : item.productName;
}

/** One entry per short item, in the order of the products card. */
export function shortItemLines(order: StockOrder) {
  if (order.stockDue?.kind !== "waiting" && order.stockDue?.kind !== "partial_waiting") return [];
  const available = new Map(order.stockDue.shortItems.map(({ variantId, available }) => [variantId, available]));
  return order.items.filter(item => available.has(item.variantId))
    .map(item => ({ variantId: item.variantId, name: stockItemName(item), quantity: item.quantity, available: available.get(item.variantId) ?? 0 }));
}

/** «Camisa (M) y Polo (L)», «Camisa (M), Polo (L) y Short (S)». */
export function joinNames(names: readonly string[], language: string) {
  return new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(names);
}

type Block = NonNullable<ReturnType<typeof orderFulfillmentBlock>>;

/** Text key and short-item list of the reason a ship or deliver button is disabled; the stock reasons name only the short items. */
export function fulfillmentReason(block: Block, operation: "ship" | "deliver", order: StockOrder, language: string) {
  if (block.code === "STOCK_WAITING") {
    const names = shortItemLines(order).map(line => line.name);
    return { key: `orderFulfillment.STOCK_WAITING_${operation}` as const, items: joinNames(names, language) };
  }
  if (block.code === "STOCK_DEDUCTING") return { key: "orderFulfillment.STOCK_DEDUCTING" as const, items: "" };
  return { key: `orderFulfillment.${operation === "ship" && block.code === "PAYMENT_REQUIRED" ? "SHIP_PAYMENT_REQUIRED" : block.code}` as const, items: "" };
}

/** Success text of a recorded payment, chosen from the order the response returns. */
export function paymentRecordedKey(order: Pick<StockOrder, "stockDue">) {
  return order.stockDue?.kind === "waiting" || order.stockDue?.kind === "partial_waiting" ? "orders.paymentRecordedWaiting" as const : "orders.paymentRecorded" as const;
}
