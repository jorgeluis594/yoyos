import { listOrdersResponseSchema, orderSchema } from "@shared/contracts/orders";
import type { Order } from "@core/src/features/orders/domain/order";
import type { ListOrdersOutput } from "@core/src/features/orders/application/read-orders";

export function toOrderJson(order: Order) {
  return orderSchema.parse({ id: order.id, companyId: order.companyId, sellerId: order.sellerId, customer: order.customer,
    paymentMethod: order.paymentMethod, completedAt: order.completedAt.toISOString(), currency: order.total.currency, total: order.total.amount,
    items: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
      variantAttributes: item.variantAttributes, sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice.amount, subtotal: item.subtotal.amount })) });
}

export function toOrderListJson(list: ListOrdersOutput) {
  return listOrdersResponseSchema.parse({ ...list, items: list.items.map((item) => ({ ...item,
    completedAt: item.completedAt.toISOString(), currency: item.total.currency, total: item.total.amount })) });
}
