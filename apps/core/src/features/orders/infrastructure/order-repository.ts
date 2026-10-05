import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { isCurrency } from "@shared/money";
import { getCompanyId, prisma, requireActiveTransaction, withLockedForUpdate } from "@core/src/shared/infrastructure/persistance";
import { buildOrder, type OrderItemId, type OrderId, type ContactId, type CompanyId, type UserId, type PositiveInteger, type PaymentId } from "@core/src/features/orders/domain/order";
import { orderStateMachine, parseDeliveryDetails, type OrderAggregate, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderCriteria } from "@core/src/features/orders/application/read-orders";
import type { AggregateCriteria, AggregatePage } from "@core/src/features/orders/application/list-order-aggregates";
import type { VariantId } from "@core/src/features/products/domain/product";

const aggregateInclude = { items: { orderBy: { id: "asc" as const } }, payments: { orderBy: [{ recordedAt: "asc" as const }, { id: "asc" as const }] } };
type DbAggregate = Prisma.OrderGetPayload<{ include: typeof aggregateInclude }>;
class InvalidStoredOrderError extends Error {}

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapAggregate(row: DbAggregate): OrderAggregate {
  if (!isCurrency(row.currency) || !row.items.length || (row.contactId && !row.contactPhone) ||
    row.items.some((item) => item.quantity <= 0n || item.quantity > BigInt(Number.MAX_SAFE_INTEGER)))
    throw new InvalidStoredOrderError("Invalid stored order identity or items");
  const delivery = row.delivery === null ? null : parseDeliveryDetails(row.delivery);
  if (delivery !== null && !delivery.success) throw new InvalidStoredOrderError("Invalid stored order delivery");
  if (row.deliveryStatus !== "pending" && row.deliveryStatus !== "shipped" && row.deliveryStatus !== "delivered") throw new InvalidStoredOrderError("Invalid stored delivery state");
  const items = row.items.map((item) => {
    const attributes = item.variantAttributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string"))
      throw new InvalidStoredOrderError("Invalid stored order attributes");
    return { id: item.id as OrderItemId, variantId: item.variantId as VariantId, productName: item.productName,
      variantAttributes: { ...attributes } as Record<string, string>, sku: item.sku, quantity: Number(item.quantity) as PositiveInteger,
      unitPrice: { amount: item.unitPrice.toNumber(), currency: row.currency }, subtotal: { amount: item.subtotal.toNumber(), currency: row.currency } };
  }) as [OrderAggregate["items"][number], ...OrderAggregate["items"][number][]];
  const payments: Payment[] = row.payments.map((payment) => {
    if (payment.method !== "digital_wallet" || !isCurrency(payment.currency) || payment.currency !== row.currency)
      throw new InvalidStoredOrderError("Invalid stored payment");
    return { id: payment.id as PaymentId, orderId: payment.orderId as OrderId,
      amount: { amount: payment.amount.toNumber(), currency: payment.currency }, method: payment.method, recordedAt: payment.recordedAt };
  });
  const order: OrderAggregate = { id: row.id as OrderId, companyId: row.companyId as CompanyId, sellerId: row.sellerId as UserId,
    customer: row.contactId ? { kind: "contact", contactId: row.contactId as ContactId, name: row.contactName, phone: row.contactPhone! } : { kind: "general_public" },
    createdAt: row.createdAt, completedAt: row.completedAt, cancelled: row.cancelled, items, payments,
    delivery: delivery === null ? null : delivery.data, deliveryStatus: row.deliveryStatus, stockDeducted: row.stockDeducted,
    itemsTotal: { amount: row.itemsTotal.toNumber(), currency: row.currency },
    deliveryCost: { amount: row.deliveryCost.toNumber(), currency: row.currency },
    deliveryCharge: { amount: row.deliveryCharge.toNumber(), currency: row.currency },
    total: { amount: row.total.toNumber(), currency: row.currency } };
  const rebuilt = buildOrder({ id: order.id, companyId: order.companyId, sellerId: order.sellerId,
    customer: order.customer, createdAt: order.createdAt, items: order.items });
  if (!rebuilt.success || rebuilt.data.total.amount !== order.itemsTotal.amount ||
    rebuilt.data.items.some((item, index) => item.subtotal.amount !== order.items[index]?.subtotal.amount))
    throw new InvalidStoredOrderError("Invalid stored order item totals");
  if (!orderStateMachine.getLifecycle(order).success) throw new InvalidStoredOrderError("Invalid stored order state");
  return order;
}

export async function savePendingOrder(order: OrderAggregate) {
  try {
    await prisma.order.create({ data: { id: order.id, companyId: order.companyId, sellerId: order.sellerId,
      contactId: order.customer.kind === "contact" ? order.customer.contactId : null,
      contactName: order.customer.kind === "contact" ? order.customer.name : null,
      contactPhone: order.customer.kind === "contact" ? order.customer.phone : null,
      currency: order.total.currency, total: new Prisma.Decimal(order.total.amount.toString()),
      itemsTotal: new Prisma.Decimal(order.itemsTotal.amount.toString()),
      deliveryCost: new Prisma.Decimal(order.deliveryCost.amount.toString()),
      deliveryCharge: new Prisma.Decimal(order.deliveryCharge.amount.toString()),
      delivery: Prisma.JsonNull,
      deliveryStatus: order.deliveryStatus, stockDeducted: order.stockDeducted, cancelled: order.cancelled,
      createdAt: order.createdAt, completedAt: order.completedAt,
      items: { create: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
        variantAttributes: item.variantAttributes as Prisma.InputJsonObject, sku: item.sku, quantity: BigInt(item.quantity),
        unitPrice: new Prisma.Decimal(item.unitPrice.amount.toString()), subtotal: new Prisma.Decimal(item.subtotal.amount.toString()) })) },
    } });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return err({ code: "ORDER_ALREADY_EXISTS" as const, message: "Order already exists" });
    log.error({ event: "unable_to_save_pending_order", err: cause }, "unable_to_save_pending_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save pending order" });
  }
}

export async function orderExists(id: string) {
  try {
    return ok(!!await prisma.order.findFirst({ where: { id }, select: { id: true } }));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_check_order_id", err: cause }, "unable_to_check_order_id");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to check order ID" });
  }
}

export async function findOrderAggregate(id: OrderId, companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const row = await prisma.order.findFirst({ where: { id, companyId }, include: aggregateInclude });
    return ok(row ? mapAggregate(row) : null);
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) return err({ code: "INVALID_ORDER" as const, message: cause.message });
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_order_aggregate", err: cause }, "unable_to_load_order_aggregate");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load order aggregate" });
  }
}

export async function findOrderForUpdate(id: OrderId, companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    return await withLockedForUpdate(companyId,
      Prisma.sql`SELECT id FROM "Order" WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`,
      (row: { id: string } | null) => row ? findOrderAggregate(id, companyId) : ok(null));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_lock_order", err: cause }, "unable_to_lock_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to lock order" });
  }
}

export async function saveStockDeduction(id: OrderId, companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, stockDeducted: false }, data: { stockDeducted: true } });
    if (updated.count !== 1) throw new Error("Locked order was not available for stock deduction");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_stock_deduction", err: cause }, "unable_to_save_stock_deduction");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save stock deduction" });
  }
}

export async function savePayment(payment: Payment, companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    await prisma.payment.create({ data: { id: payment.id, companyId, orderId: payment.orderId,
      amount: new Prisma.Decimal(payment.amount.amount.toString()), currency: payment.amount.currency,
      method: payment.method, recordedAt: payment.recordedAt } });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002")
      return err({ code: "PAYMENT_CONFLICT" as const, message: "Payment ID already exists" });
    log.error({ event: "unable_to_save_payment", err: cause }, "unable_to_save_payment");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save payment" });
  }
}

export async function saveFulfillment(id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "deliveryStatus" | "completedAt">) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, cancelled: false, stockDeducted: true,
      deliveryStatus: change.deliveryStatus === "shipped" ? "pending" : { in: ["pending", "shipped"] } },
    data: { deliveryStatus: change.deliveryStatus, completedAt: change.completedAt } });
    if (updated.count !== 1) throw new Error("Locked order was not available for fulfillment");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_fulfillment", err: cause }, "unable_to_save_fulfillment");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save fulfillment" });
  }
}

export async function saveCancellation(id: OrderId, companyId: CompanyId, stockDeducted: false) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, deliveryStatus: "pending", cancelled: false, completedAt: null },
      data: { cancelled: true, stockDeducted } });
    if (updated.count !== 1) throw new Error("Locked order was not available for cancellation");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_order_cancellation", err: cause }, "unable_to_save_order_cancellation");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order cancellation" });
  }
}

export async function saveDelivery(id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) {
  requireActiveTransaction(companyId);
  if (change.delivery === null || !parseDeliveryDetails(change.delivery).success) throw new Error("Invalid delivery snapshot");
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, deliveryStatus: "pending", cancelled: false },
      data: { delivery: change.delivery as Prisma.InputJsonObject,
        deliveryCost: new Prisma.Decimal(change.deliveryCost.amount.toString()),
        deliveryCharge: new Prisma.Decimal(change.deliveryCharge.amount.toString()),
        total: new Prisma.Decimal(change.total.amount.toString()) } });
    if (updated.count !== 1) throw new Error("Locked order was not available for delivery update");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_order_delivery", err: cause }, "unable_to_save_order_delivery");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order delivery" });
  }
}

export async function findOrders(criteria: OrderCriteria) {
  const where: Prisma.OrderWhereInput = {
    companyId: getCompanyId(),
    ...(criteria.customer.kind === "general_public" ? { contactId: null } : criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    completedAt: { not: null, ...(criteria.completedFrom ? { gte: criteria.completedFrom } : {}), ...(criteria.completedBefore ? { lt: criteria.completedBefore } : {}) },
  };
  try {
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: [{ completedAt: "desc" }, { id: "asc" }], skip: (criteria.page - 1) * 20, take: 20,
        select: { id: true, completedAt: true, contactId: true, contactName: true, contactPhone: true, sellerId: true, currency: true, total: true } }),
      prisma.order.count({ where }),
    ]);
    return ok({ items: rows.map((row) => {
      if (!row.completedAt || !isCurrency(row.currency) || (row.contactId && !row.contactPhone))
        throw new InvalidStoredOrderError("Invalid stored order summary");
      return { id: row.id, completedAt: row.completedAt, sellerId: row.sellerId,
        customer: row.contactId ? { kind: "contact" as const, contactId: row.contactId, name: row.contactName, phone: row.contactPhone! } : { kind: "general_public" as const },
        total: { amount: row.total.toNumber(), currency: row.currency } };
    }), page: criteria.page, pageSize: 20, total });
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) return err({ code: "INVALID_ORDER" as const, message: cause.message });
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_list_orders", err: cause }, "unable_to_list_orders");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list orders" });
  }
}

export async function findOrderAggregates(criteria: AggregateCriteria, companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  const where: Prisma.OrderWhereInput = { companyId,
    ...(criteria.customer.kind === "general_public" ? { contactId: null } : criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    ...(criteria.createdFrom || criteria.createdBefore ? { createdAt: {
      ...(criteria.createdFrom ? { gte: criteria.createdFrom } : {}), ...(criteria.createdBefore ? { lt: criteria.createdBefore } : {}),
    } } : {}),
  };
  try {
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, include: aggregateInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (criteria.page - 1) * 20, take: 20 }),
      prisma.order.count({ where }),
    ]);
    return ok<AggregatePage>({ items: rows.map(mapAggregate), page: criteria.page, pageSize: 20, total });
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) return err({ code: "INVALID_ORDER" as const, message: cause.message });
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_list_order_aggregates", err: cause }, "unable_to_list_order_aggregates");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list orders" });
  }
}
