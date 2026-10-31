import type { OrderStockDue } from "@shared/contracts/orders";

type FulfillmentState = Readonly<{
  cancelled: boolean;
  deliveryStatus: "pending" | "shipped" | "delivered";
  paidAmount: Readonly<{ amount: number }>;
  stockDeducted: boolean;
}>;

/** Shipping and delivering need a confirmed payment, partial or full, and deduct pending stock themselves. */
export function fulfillmentBlock(order: FulfillmentState, operation: "ship" | "deliver") {
  if (order.cancelled) return "ORDER_CANCELLED";
  if (order.deliveryStatus === "delivered" || (operation === "ship" && order.deliveryStatus !== "pending")) return "INVALID_TRANSITION";
  return order.paidAmount.amount > 0 ? null : "PAYMENT_REQUIRED";
}

export type StockFulfillmentBlock =
  | Readonly<{ code: "STOCK_WAITING"; variantIds: readonly [string, ...string[]] }>
  | Readonly<{ code: "STOCK_DEDUCTING" }>;

/** Ship is blocked only while the order waits for stock; deliver also while its stock is being deducted. */
export function stockFulfillmentBlock(order: Readonly<{ stockDue: OrderStockDue | null }>, operation: "ship" | "deliver"): StockFulfillmentBlock | null {
  const due = order.stockDue;
  if (due === null) return null;
  if (due.kind === "waiting") {
    const [first, ...rest] = due.shortItems.map((item) => item.variantId);
    return { code: "STOCK_WAITING", variantIds: [first!, ...rest] };
  }
  return operation === "deliver" ? { code: "STOCK_DEDUCTING" } : null;
}

/** The only function clients call: payment and transition reasons first, then the stock block. */
export function orderFulfillmentBlock(order: FulfillmentState & Readonly<{ stockDue: OrderStockDue | null }>, operation: "ship" | "deliver") {
  const base = fulfillmentBlock(order, operation);
  return base === null ? stockFulfillmentBlock(order, operation) : { code: base } as const;
}
