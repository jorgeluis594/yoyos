type FulfillmentState = Readonly<{
  cancelled: boolean;
  deliveryStatus: "pending" | "shipped" | "delivered";
  paymentStatus: "pending" | "paid";
  paidAmount: Readonly<{ amount: number }>;
  stockDeducted: boolean;
}>;

/** Shipping needs a confirmed payment, partial or full, and deducts pending stock itself; delivering needs full coverage and deducted stock. */
export function fulfillmentBlock(order: FulfillmentState, operation: "ship" | "deliver") {
  if (order.cancelled) return "ORDER_CANCELLED";
  if (order.deliveryStatus === "delivered" || (operation === "ship" && order.deliveryStatus !== "pending")) return "INVALID_TRANSITION";
  if (operation === "ship") return order.paidAmount.amount > 0 ? null : "PAYMENT_REQUIRED";
  if (order.paymentStatus !== "paid") return "PAYMENT_REQUIRED";
  if (!order.stockDeducted) return "STOCK_NOT_DEDUCTED";
  return null;
}
