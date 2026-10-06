type FulfillmentState = Readonly<{
  cancelled: boolean;
  deliveryStatus: "pending" | "shipped" | "delivered";
  paymentStatus: "pending" | "paid";
  stockDeducted: boolean;
}>;

export function fulfillmentBlock(order: FulfillmentState, operation: "ship" | "deliver") {
  if (order.cancelled) return "ORDER_CANCELLED";
  if (order.deliveryStatus === "delivered" || (operation === "ship" && order.deliveryStatus !== "pending")) return "INVALID_TRANSITION";
  if (order.paymentStatus !== "paid") return "PAYMENT_REQUIRED";
  if (!order.stockDeducted) return "STOCK_NOT_DEDUCTED";
  return null;
}
