import { listOrderAggregatesResponseSchema, listOrdersResponseSchema, orderAggregateSchema, orderAggregateSummarySchema, orderSchema } from "@shared/contracts/orders";
import { orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ListOrdersOutput } from "@core/src/features/orders/application/read-orders";
import type { AggregatePage } from "@core/src/features/orders/application/list-order-aggregates";

export function toLegacyOrderJson(order: OrderAggregate) {
  if (!order.completedAt || order.deliveryStatus !== "delivered") throw new Error("Immediate sale is not completed");
  return orderSchema.parse({ id: order.id, companyId: order.companyId, sellerId: order.sellerId, customer: order.customer,
    paymentMethod: "digital_wallet", completedAt: order.completedAt.toISOString(), currency: order.total.currency, total: order.total.amount,
    items: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
      variantAttributes: item.variantAttributes, sku: item.sku, quantity: item.quantity,
      unitPrice: item.unitPrice.amount, subtotal: item.subtotal.amount })) });
}

export function toOrderAggregateJson(order: OrderAggregate) {
  const lifecycle = orderStateMachine.getLifecycle(order);
  const payment = orderStateMachine.getPaymentSummary(order);
  if (!lifecycle.success || !payment.success) throw new Error("Invalid order aggregate response");
  return orderAggregateSchema.parse({ ...order, createdAt: order.createdAt.toISOString(), deliveredAt: order.deliveredAt?.toISOString() ?? null,
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
    const { id, createdAt, deliveredAt, completedAt, status, paymentStatus, deliveryStatus, stockDeducted, customer, sellerId, total } = toOrderAggregateJson(item);
    return orderAggregateSummarySchema.parse({ id, createdAt, deliveredAt, completedAt, status, paymentStatus, deliveryStatus, stockDeducted, customer, sellerId, total });
  }) });
}

export function toOrderListJson(list: ListOrdersOutput) {
  return listOrdersResponseSchema.parse({ ...list, items: list.items.map((item) => ({ ...item,
    completedAt: item.completedAt.toISOString(), currency: item.total.currency, total: item.total.amount })) });
}
