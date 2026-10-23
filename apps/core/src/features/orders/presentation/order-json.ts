import { listOrderAggregatesResponseSchema, listOrdersResponseSchema, orderAggregateSchema, orderAggregateSummarySchema, orderSchema } from "@shared/contracts/orders";
import { orderSource, orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ListOrdersOutput } from "@core/src/features/orders/application/read-orders";
import type { AggregatePage } from "@core/src/features/orders/application/list-order-aggregates";

export function toLegacyOrderJson(order: OrderAggregate) {
  if (!order.completedAt || order.deliveryStatus !== "delivered") throw new Error("Immediate sale is not completed");
  return orderSchema.parse({ number: order.number, id: order.id, companyId: order.companyId, sellerId: order.sellerId, buyer: order.buyer, source: orderSource(order),
    paymentMethod: "digital_wallet", completedAt: order.completedAt.toISOString(), currency: order.total.currency, total: order.total.amount,
    items: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
      variantAttributes: item.variantAttributes, sku: item.sku, quantity: item.quantity,
      unitPrice: item.unitPrice.amount, subtotal: item.subtotal.amount, mentionedPrice: null })) });
}

export function toOrderAggregateJson(order: OrderAggregate) {
  const lifecycle = orderStateMachine.getLifecycle(order);
  const payment = orderStateMachine.getPaymentSummary(order);
  if (!lifecycle.success || !payment.success) throw new Error("Invalid order aggregate response");
  // The contract exposes `source`, not the chat id or the catalog flag.
  const fields = Object.fromEntries(Object.entries(order).filter(([key]) => key !== "chatId" && key !== "fromCatalog"));
  return orderAggregateSchema.parse({ ...fields, items: order.items.map((item) => ({ ...item, mentionedPrice: item.mentionedPrice ?? null })), source: orderSource(order), checkoutEnabledAt: order.checkoutEnabledAt?.toISOString() ?? null, checkoutConfirmedAt: order.checkoutConfirmedAt?.toISOString() ?? null, createdAt: order.createdAt.toISOString(), shippedAt: order.shippedAt?.toISOString() ?? null, deliveredAt: order.deliveredAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null, status: lifecycle.data.status,
    paymentStatus: payment.data.status, paidAmount: payment.data.paidAmount,
    balanceDue: payment.data.balanceDue, overpaidAmount: payment.data.overpaidAmount,
    payments: order.payments.map((item) => item.status === "reported" ? { ...item,
      data: { ...item.data, reportedAt: item.data.reportedAt.toISOString() } } : { ...item,
      data: { ...item.data, confirmedAt: item.data.confirmedAt.toISOString(),
        evidence: item.data.evidence.kind === "manual" ? item.data.evidence : { kind: "buyer_report",
          report: { ...item.data.evidence.report, reportedAt: item.data.evidence.report.reportedAt.toISOString() } },
        ...(item.status === "voided" ? { voidedAt: item.data.voidedAt.toISOString() } : {}) } }) });
}

export function toOrderAggregateListJson(page: AggregatePage) {
  return listOrderAggregatesResponseSchema.parse({ ...page, items: page.items.map((item) => {
    const { number, id, createdAt, scheduledDispatchDate, shippedAt, deliveredAt, completedAt, status, paymentStatus, deliveryStatus, stockDeducted, buyer, source, checkoutEnabledAt, checkoutConfirmedAt, sellerId, total, delivery } = toOrderAggregateJson(item);
    return orderAggregateSummarySchema.parse({ number, id, createdAt, scheduledDispatchDate, shippedAt, deliveredAt, completedAt, status, paymentStatus, deliveryStatus, stockDeducted, buyer, source, checkoutEnabledAt, checkoutConfirmedAt, sellerId, total,
      courier: delivery?.method === "agency" ? delivery.courier : null });
  }) });
}

export function toOrderListJson(list: ListOrdersOutput) {
  return listOrdersResponseSchema.parse({ ...list, items: list.items.map((item) => ({ ...item,
    completedAt: item.completedAt.toISOString(), currency: item.total.currency, total: item.total.amount })) });
}
