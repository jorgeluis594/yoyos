import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { isCurrency } from "@shared/money";
import { getCompanyId, prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { buildOrder, type Order, type OrderItemId, type OrderId, type ContactId, type CompanyId, type UserId, type PositiveInteger, type PaymentId } from "@core/src/features/orders/domain/order";
import type { CreateOrderError } from "@core/src/features/orders/application/create-order";
import { orderStateMachine, parseDeliveryDetails, type OrderAggregate, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderCriteria } from "@core/src/features/orders/application/read-orders";
import type { VariantId } from "@core/src/features/products/domain/product";

const include = { items: { orderBy: { id: "asc" as const } } };
type DbOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
const aggregateInclude = { items: { orderBy: { id: "asc" as const } }, payments: { orderBy: [{ recordedAt: "asc" as const }, { id: "asc" as const }] } };
type DbAggregate = Prisma.OrderGetPayload<{ include: typeof aggregateInclude }>;

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapOrder(row: DbOrder): Order {
  if (!row.completedAt || row.paymentMethod !== "digital_wallet") throw new Error("Order is not a completed immediate sale");
  if (!isCurrency(row.currency)) throw new Error("Invalid stored order currency");
  if (!row.items.length || row.items.some((item) => item.quantity <= 0n || item.quantity > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error("Invalid stored order quantity");
  const items = row.items.map((item) => {
    const attributes = item.variantAttributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string")) throw new Error("Invalid stored order attributes");
    return { id: item.id as OrderItemId, variantId: item.variantId as VariantId, productName: item.productName,
      variantAttributes: { ...attributes } as Record<string, string>, sku: item.sku, quantity: Number(item.quantity) as PositiveInteger,
      unitPrice: { amount: item.unitPrice.toNumber(), currency: row.currency }, subtotal: { amount: item.subtotal.toNumber(), currency: row.currency } };
  }) as [Order["items"][number], ...Order["items"][number][]];
  return { id: row.id as OrderId, companyId: row.companyId as CompanyId, sellerId: row.sellerId as UserId,
    customer: row.contactId ? { kind: "contact", contactId: row.contactId as ContactId, name: row.contactName, phone: row.contactPhone! } : { kind: "general_public" },
    paymentMethod: "digital_wallet", completedAt: row.completedAt, items, total: { amount: row.total.toNumber(), currency: row.currency } };
}

function mapAggregate(row: DbAggregate): OrderAggregate {
  if (!isCurrency(row.currency) || !row.items.length || (row.contactId && !row.contactPhone) ||
    row.items.some((item) => item.quantity <= 0n || item.quantity > BigInt(Number.MAX_SAFE_INTEGER)))
    throw new Error("Invalid stored order identity or items");
  const delivery = row.delivery === null ? null : parseDeliveryDetails(row.delivery);
  if (delivery !== null && !delivery.success) throw new Error("Invalid stored order delivery");
  if (row.deliveryStatus !== "pending" && row.deliveryStatus !== "shipped" && row.deliveryStatus !== "delivered") throw new Error("Invalid stored delivery state");
  const items = row.items.map((item) => {
    const attributes = item.variantAttributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string"))
      throw new Error("Invalid stored order attributes");
    return { id: item.id as OrderItemId, variantId: item.variantId as VariantId, productName: item.productName,
      variantAttributes: { ...attributes } as Record<string, string>, sku: item.sku, quantity: Number(item.quantity) as PositiveInteger,
      unitPrice: { amount: item.unitPrice.toNumber(), currency: row.currency }, subtotal: { amount: item.subtotal.toNumber(), currency: row.currency } };
  }) as [OrderAggregate["items"][number], ...OrderAggregate["items"][number][]];
  const payments: Payment[] = row.payments.map((payment) => {
    if (payment.method !== "digital_wallet" || !isCurrency(payment.currency) || payment.currency !== row.currency)
      throw new Error("Invalid stored payment");
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
    customer: order.customer, completedAt: order.createdAt, items: order.items });
  if (!rebuilt.success || rebuilt.data.total.amount !== order.itemsTotal.amount ||
    rebuilt.data.items.some((item, index) => item.subtotal.amount !== order.items[index]?.subtotal.amount))
    throw new Error("Invalid stored order item totals");
  if (!orderStateMachine.getLifecycle(order).success) throw new Error("Invalid stored order state");
  return order;
}

export async function saveOrder(order: Order, paymentId: PaymentId) {
  try {
    await prisma.order.create({ data: { id: order.id, sellerId: order.sellerId,
      contactId: order.customer.kind === "contact" ? order.customer.contactId : null,
      contactName: order.customer.kind === "contact" ? order.customer.name : null,
      contactPhone: order.customer.kind === "contact" ? order.customer.phone : null,
      currency: order.total.currency, total: new Prisma.Decimal(order.total.amount.toString()),
      itemsTotal: new Prisma.Decimal(order.total.amount.toString()), createdAt: order.completedAt,
      deliveryStatus: "delivered", stockDeducted: true, paymentMethod: order.paymentMethod, completedAt: order.completedAt,
      payments: { create: { id: paymentId, amount: new Prisma.Decimal(order.total.amount.toString()),
        currency: order.total.currency, method: order.paymentMethod, recordedAt: order.completedAt } },
      items: { create: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
        variantAttributes: item.variantAttributes as Prisma.InputJsonObject, sku: item.sku, quantity: BigInt(item.quantity),
        unitPrice: new Prisma.Decimal(item.unitPrice.amount.toString()), subtotal: new Prisma.Decimal(item.subtotal.amount.toString()) })) },
    } });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return err<CreateOrderError>({ code: "ORDER_ALREADY_EXISTS", message: "Order already exists" });
    console.error("Unable to save order", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err<CreateOrderError>({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save order" });
  }
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
      createdAt: order.createdAt, completedAt: order.completedAt, paymentMethod: null,
      items: { create: order.items.map((item) => ({ id: item.id, variantId: item.variantId, productName: item.productName,
        variantAttributes: item.variantAttributes as Prisma.InputJsonObject, sku: item.sku, quantity: BigInt(item.quantity),
        unitPrice: new Prisma.Decimal(item.unitPrice.amount.toString()), subtotal: new Prisma.Decimal(item.subtotal.amount.toString()) })) },
    } });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return err({ code: "ORDER_ALREADY_EXISTS" as const, message: "Order already exists" });
    console.error("Unable to save pending order", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save pending order" });
  }
}

export async function orderExists(id: string) {
  try {
    return ok(!!await prisma.order.findFirst({ where: { id }, select: { id: true } }));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    console.error("Unable to check order ID", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to check order ID" });
  }
}

export async function findOrder(id: string) {
  try {
    const row = await prisma.order.findFirst({ where: { id }, include });
    return ok(row ? mapOrder(row) : null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    console.error("Unable to load order", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load order" });
  }
}

export async function findOrderAggregate(id: OrderId, companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const row = await prisma.order.findFirst({ where: { id, companyId }, include: aggregateInclude });
    return ok(row ? mapAggregate(row) : null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    console.error("Unable to load order aggregate", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load order aggregate" });
  }
}

export async function findOrderForUpdate(id: OrderId, companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Order" WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    return rows.length ? findOrderAggregate(id, companyId) : ok(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    console.error("Unable to lock order", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
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
    console.error("Unable to save stock deduction", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save stock deduction" });
  }
}

export async function findOrders(criteria: OrderCriteria) {
  const where: Prisma.OrderWhereInput = {
    ...(criteria.customer.kind === "general_public" ? { contactId: null } : criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    completedAt: { not: null, ...(criteria.completedFrom ? { gte: criteria.completedFrom } : {}), ...(criteria.completedBefore ? { lt: criteria.completedBefore } : {}) },
  };
  try {
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: [{ completedAt: "desc" }, { id: "asc" }], skip: (criteria.page - 1) * 20, take: 20,
        select: { id: true, completedAt: true, contactId: true, contactName: true, contactPhone: true, sellerId: true, currency: true, total: true } }),
      prisma.order.count({ where }),
    ]);
    return ok({ items: rows.map((row) => { if (!row.completedAt) throw new Error("Completed order has no date"); return { id: row.id, completedAt: row.completedAt, sellerId: row.sellerId,
      customer: row.contactId ? { kind: "contact" as const, contactId: row.contactId, name: row.contactName, phone: row.contactPhone! } : { kind: "general_public" as const },
      total: { amount: row.total.toNumber(), currency: row.currency } }; }), page: criteria.page, pageSize: 20, total });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    console.error("Unable to list orders", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list orders" });
  }
}
