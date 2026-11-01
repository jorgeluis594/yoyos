import { listOrderAggregatesResponseSchema, listOrdersResponseSchema, orderAggregateSchema, orderAggregateSummarySchema, orderSchema } from "@shared/contracts/orders";
import { orderSource, orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { StockDue } from "@core/src/features/orders/domain/stock-deduction";
import type { ListOrdersOutput } from "@core/src/features/orders/application/read-orders";
import type { AggregatePage } from "@core/src/features/orders/application/list-order-aggregates";

/** The partial deduction request is stored on the confirmation but is not part of the payment contract. */
function withoutStockRequest<P extends { deductStockIfPartial?: boolean }>(payment: P): Omit<P, "deductStockIfPartial"> {
  const rest: Partial<P> = { ...payment };
  delete rest.deductStockIfPartial;
  return rest as Omit<P, "deductStockIfPartial">;
}

export function toLegacyOrderJson(order: OrderAggregate) {
  if (!order.completedAt || order.deliveryStatus !== "delivered") throw new Error("Immediate sale is not completed");
  return orderSchema.parse({ number: order.number, id: order.id, companyId: order.companyId, sellerId: order.sellerId, buyer: order.buyer, source: orderSource(order),
    paymentMethod: "digital_wallet", completedAt: order.completedAt.toISOString(), currency: order.total.currency, total: order.total.amount,
    items: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
      variantAttributes: item.variantAttributes, sku: item.sku, quantity: item.quantity,
      unitPrice: item.unitPrice.amount, subtotal: item.subtotal.amount, mentionedPrice: item.mentionedPrice ?? null })) });
}

/** The per-line deducted units are internal; the contract exposes the order-level stockDue instead. */
function omitDeducted<T extends { stockDeductedQuantity: number }>(item: T): Omit<T, "stockDeductedQuantity"> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "stockDeductedQuantity")) as Omit<T, "stockDeductedQuantity">;
}

/** `stockDue` is described by the caller: inside the producer's transaction or in a read snapshot. Summaries and lists pass null and never expose it. */
export function toOrderAggregateJson(order: OrderAggregate, stockDue: StockDue | null) {
  const lifecycle = orderStateMachine.getLifecycle(order);
  const payment = orderStateMachine.getPaymentSummary(order);
  if (!lifecycle.success || !payment.success) throw new Error("Invalid order aggregate response");
  // The contract exposes `source`, not the chat id, or the catalog flag.
  const fields = Object.fromEntries(Object.entries(order).filter(([key]) => !["chatId", "fromCatalog"].includes(key)));
  return orderAggregateSchema.parse({ ...fields, items: order.items.map((item) => ({ ...omitDeducted(item), mentionedPrice: item.mentionedPrice ?? null })), source: orderSource(order), stockDue, checkoutEnabledAt: order.checkoutEnabledAt?.toISOString() ?? null, checkoutConfirmedAt: order.checkoutConfirmedAt?.toISOString() ?? null, createdAt: order.createdAt.toISOString(), shippedAt: order.shippedAt?.toISOString() ?? null, deliveredAt: order.deliveredAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null, cancelledAt: order.cancelledAt?.toISOString() ?? null, stockDeductedAt: order.stockDeductedAt?.toISOString() ?? null, status: lifecycle.data.status,
    paymentStatus: payment.data.status, paidAmount: payment.data.paidAmount,
    balanceDue: payment.data.balanceDue, overpaidAmount: payment.data.overpaidAmount,
    payments: order.payments.map((item) => item.status === "reported" ? { ...item,
      data: { ...item.data, reportedAt: item.data.reportedAt.toISOString() } } : item.status === "rejected" ? { ...item,
      data: { ...item.data, report: { ...item.data.report, reportedAt: item.data.report.reportedAt.toISOString() },
        rejectedAt: item.data.rejectedAt.toISOString() } } : { ...withoutStockRequest(item),
      data: { ...item.data, confirmedAt: item.data.confirmedAt.toISOString(),
        evidence: item.data.evidence.kind === "manual" ? item.data.evidence : { kind: "buyer_report",
          report: { ...item.data.evidence.report, reportedAt: item.data.evidence.report.reportedAt.toISOString() } },
        ...(item.status === "voided" ? { voidedAt: item.data.voidedAt.toISOString() } : {}) } }) });
}

export function toOrderAggregateListJson(page: AggregatePage) {
  return listOrderAggregatesResponseSchema.parse({ ...page, items: page.items.map((item) => {
    const { number, id, createdAt, scheduledDispatchDate, shippedAt, deliveredAt, completedAt, status, paymentStatus, deliveryStatus, stockDeducted, buyer, source, checkoutEnabledAt, checkoutConfirmedAt, sellerId, total, delivery } = toOrderAggregateJson(item, null);
    return orderAggregateSummarySchema.parse({ number, id, createdAt, scheduledDispatchDate, shippedAt, deliveredAt, completedAt, status, paymentStatus, deliveryStatus, stockDeducted, buyer, source, checkoutEnabledAt, checkoutConfirmedAt, sellerId, total,
      courier: delivery?.method === "agency" ? delivery.courier : null });
  }) });
}

// Web-only list data read from the stored snapshot; never added to the mobile list JSON.
export function toOrderListDispatchFields({ delivery }: OrderAggregate) {
  if (!delivery) return { deliveryMethod: "none", district: null } as const;
  if (delivery.method === "home") return { deliveryMethod: "home", district: delivery.destination.district } as const;
  if (delivery.method === "agency") return { deliveryMethod: "agency", district: delivery.agency.location.district } as const;
  return { deliveryMethod: "pickup", district: null } as const;
}

export function toOrderListJson(list: ListOrdersOutput) {
  return listOrdersResponseSchema.parse({ ...list, items: list.items.map((item) => ({ ...item,
    completedAt: item.completedAt.toISOString(), currency: item.total.currency, total: item.total.amount })) });
}
