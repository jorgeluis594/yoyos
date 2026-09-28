import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { Order, OrderItemId, OrderId, ContactId, CompanyId, UserId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { CreateOrderError } from "@core/src/features/orders/application/create-order";
import type { OrderCriteria } from "@core/src/features/orders/application/read-orders";
import type { VariantId } from "@core/src/features/products/domain/product";

const include = { items: { orderBy: { id: "asc" as const } } };
type DbOrder = Prisma.OrderGetPayload<{ include: typeof include }>;

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapOrder(row: DbOrder): Order {
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

export async function saveOrder(order: Order) {
  try {
    await prisma.order.create({ data: { id: order.id, sellerId: order.sellerId,
      contactId: order.customer.kind === "contact" ? order.customer.contactId : null,
      contactName: order.customer.kind === "contact" ? order.customer.name : null,
      contactPhone: order.customer.kind === "contact" ? order.customer.phone : null,
      currency: order.total.currency, total: new Prisma.Decimal(order.total.amount.toString()), paymentMethod: order.paymentMethod, completedAt: order.completedAt,
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

export async function findOrders(criteria: OrderCriteria) {
  const where: Prisma.OrderWhereInput = {
    ...(criteria.customer.kind === "general_public" ? { contactId: null } : criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    completedAt: { ...(criteria.completedFrom ? { gte: criteria.completedFrom } : {}), ...(criteria.completedBefore ? { lt: criteria.completedBefore } : {}) },
  };
  try {
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: [{ completedAt: "desc" }, { id: "asc" }], skip: (criteria.page - 1) * 20, take: 20,
        select: { id: true, completedAt: true, contactId: true, contactName: true, contactPhone: true, sellerId: true, currency: true, total: true } }),
      prisma.order.count({ where }),
    ]);
    return ok({ items: rows.map((row) => ({ id: row.id, completedAt: row.completedAt, sellerId: row.sellerId,
      customer: row.contactId ? { kind: "contact" as const, contactId: row.contactId, name: row.contactName, phone: row.contactPhone! } : { kind: "general_public" as const },
      total: { amount: row.total.toNumber(), currency: row.currency } })), page: criteria.page, pageSize: 20, total });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    console.error("Unable to list orders", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list orders" });
  }
}
