import { z } from "zod";
import { checkoutState, parseOrderNumber, type OrderBuyer, type OrderNumber } from "@core/src/features/orders/domain/checkout";
import { log } from "@core/src/shared/infrastructure/logger";
import { isPersistenceFailure, persistenceFailureResult } from "@core/src/shared/infrastructure/persistence-error";
import type { ContainedFailure, TransactionEndingError } from "@core/src/shared/application/contained-failure";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isCurrency, type Money } from "@shared/money";
import { parseDispatchDate, type DispatchDate } from "@shared/dispatch-date";
import { getCompanyId, prisma, systemPrisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { buildOrder, type OrderItem, type OrderItemId, type OrderId, type ContactId, type CompanyId, type UserId, type PositiveInteger } from "@core/src/features/orders/domain/order";
import { orderSource, orderStateMachine, parseDeliverySnapshot, type DispatchScheduleChange, type FulfillmentChange, type OrderAggregate, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import { parsePayment } from "@core/src/features/orders/domain/payment";
import type { OrderCriteria } from "@core/src/features/orders/application/read-orders";
import type { AggregateCriteria, AggregatePage } from "@core/src/features/orders/application/list-order-aggregates";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { DispatchCandidate } from "@core/src/features/orders/domain/dispatch-readiness";
import type { UnpaidSummary } from "@core/src/features/orders/application/summarize-unpaid-orders";
import type { StockOrderRow } from "@core/src/features/orders/application/deduct-due-stock";
import { isOpenForMessageItems, type ChatId, type OrderChatSource } from "@core/src/features/orders/domain/message-order";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order";
import type { OrderItemChanges } from "@core/src/features/orders/domain/order-edit";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

const aggregateInclude = { buyer: true, items: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] }, payments: { orderBy: { id: "asc" as const } } };
type DbAggregate = Prisma.OrderGetPayload<{ include: typeof aggregateInclude }>;
class InvalidStoredOrderError extends Error {}
class InvalidStoredDeliveryError extends InvalidStoredOrderError {}
const dateText = z.iso.datetime();
const reportData = z.strictObject({ receiptImageId: z.uuid(), reportedAt: dateText });
const confirmationData = z.strictObject({ confirmedAt: dateText,
  confirmedBy: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("seller"), userId: z.string().min(1) }), z.strictObject({ kind: z.literal("legacy") })]),
  evidence: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("manual") }), z.strictObject({ kind: z.literal("buyer_report"), report: reportData })]) });
const rejectedData = z.strictObject({ report: reportData, rejectedAt: dateText, rejectedBy: z.string().min(1), reason: z.string().min(1).max(200).nullable() });
const voidedData = confirmationData.extend({ voidedAt: dateText, voidedBy: z.string().min(1) });

/** Definer function: returns only company ids, so each delete still runs under RLS. */
export async function listCompaniesWithExpiredCatalogOrders(cutoff: Date) {
  try {
    const rows = await systemPrisma.$queryRaw<{ companyId: string }[]>`SELECT public.list_companies_with_expired_catalog_orders(${cutoff}::timestamptz) AS "companyId"`;
    return ok(rows.map((row) => row.companyId as CompanyId));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list companies with expired catalog orders" });
  }
}

/** SKIP LOCKED leaves an order being confirmed; the re-evaluated WHERE then no longer matches it. */
export async function deleteExpiredCatalogOrders(companyId: CompanyId, cutoff: Date, limit: number) {
  requireActiveTransaction(companyId);
  try {
    const deleted = await prisma.$executeRaw`WITH doomed AS (
        SELECT id FROM "Order"
        WHERE "companyId" = ${companyId}::uuid AND "fromCatalog" AND "checkoutConfirmedAt" IS NULL AND "createdAt" < ${cutoff}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = "Order".id)
        ORDER BY "createdAt" LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ), items AS (DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM doomed))
      DELETE FROM "Order" WHERE id IN (SELECT id FROM doomed)`;
    return ok(deleted);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_delete_catalog_orders", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to delete catalog orders");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to delete catalog orders" });
  }
}

function mapPaymentUnsafe(row: DbAggregate["payments"][number]): Payment {
  if (!isCurrency(row.currency)) throw new InvalidStoredOrderError("Invalid stored payment currency");
  let candidate: unknown;
  if (row.status === "reported") {
    const parsed = reportData.safeParse(row.data);
    if (!parsed.success || row.amount !== null || row.method !== null) throw new InvalidStoredOrderError("Invalid stored payment report");
    candidate = { id: row.id, orderId: row.orderId, status: row.status, currency: row.currency,
      amount: null, method: null, data: { receiptImageId: parsed.data.receiptImageId, reportedAt: new Date(parsed.data.reportedAt) } };
  } else if (row.status === "rejected") {
    const parsed = rejectedData.safeParse(row.data);
    if (!parsed.success || row.amount !== null || row.method !== null) throw new InvalidStoredOrderError("Invalid stored payment rejection");
    candidate = { id: row.id, orderId: row.orderId, status: row.status, currency: row.currency, amount: null, method: null,
      data: { report: { receiptImageId: parsed.data.report.receiptImageId, reportedAt: new Date(parsed.data.report.reportedAt) },
        rejectedAt: new Date(parsed.data.rejectedAt), rejectedBy: parsed.data.rejectedBy, reason: parsed.data.reason } };
  } else if (row.status === "confirmed" || row.status === "voided") {
    const parsed = (row.status === "confirmed" ? confirmationData : voidedData).safeParse(row.data);
    if (!parsed.success || row.amount === null || (row.method !== "digital_wallet" && row.method !== "bank_transfer"))
      throw new InvalidStoredOrderError("Invalid stored payment confirmation");
    const voided = row.status === "voided" ? voidedData.safeParse(row.data) : null;
    if (voided && !voided.success) throw new InvalidStoredOrderError("Invalid stored payment void");
    const evidence = parsed.data.evidence.kind === "manual" ? parsed.data.evidence : { kind: "buyer_report",
      report: { receiptImageId: parsed.data.evidence.report.receiptImageId, reportedAt: new Date(parsed.data.evidence.report.reportedAt) } };
    candidate = { id: row.id, orderId: row.orderId, status: row.status,
      amount: { amount: row.amount.toNumber(), currency: row.currency }, method: row.method,
      ...(row.walletProvider === null ? {} : { walletProvider: row.walletProvider }), deductStockIfPartial: row.deductStockIfPartial,
      data: { confirmedAt: new Date(parsed.data.confirmedAt), confirmedBy: parsed.data.confirmedBy, evidence,
        ...(voided?.success ? { voidedAt: new Date(voided.data.voidedAt), voidedBy: voided.data.voidedBy } : {}) } };
  } else throw new InvalidStoredOrderError("Invalid stored payment status");
  const payment = parsePayment(candidate);
  if (!payment.success) throw new InvalidStoredOrderError("Invalid stored payment");
  return payment.data;
}

function mapPayment(row: DbAggregate["payments"][number]): Payment {
  try { return mapPaymentUnsafe(row); }
  catch (cause) {
    if (cause instanceof InvalidStoredOrderError) log.error({ event: "invalid_stored_payment", paymentId: row.id,
      errorCode: "INVALID_STORED_DATA" }, "invalid_stored_payment");
    throw cause;
  }
}

const stockRequested = (payment: Payment) => payment.status === "confirmed" || payment.status === "voided" ? payment.deductStockIfPartial : false;

function paymentDataJson(payment: Payment): Prisma.InputJsonObject {
  if (payment.status === "reported") return { receiptImageId: payment.data.receiptImageId, reportedAt: payment.data.reportedAt.toISOString() };
  if (payment.status === "rejected") return { report: { receiptImageId: payment.data.report.receiptImageId, reportedAt: payment.data.report.reportedAt.toISOString() },
    rejectedAt: payment.data.rejectedAt.toISOString(), rejectedBy: payment.data.rejectedBy, reason: payment.data.reason };
  const evidence: Prisma.InputJsonObject = payment.data.evidence.kind === "manual" ? { kind: "manual" } :
    { kind: "buyer_report", report: { receiptImageId: payment.data.evidence.report.receiptImageId,
      reportedAt: payment.data.evidence.report.reportedAt.toISOString() } };
  return { confirmedAt: payment.data.confirmedAt.toISOString(), confirmedBy: payment.data.confirmedBy,
    evidence, ...(payment.status === "voided" ? { voidedAt: payment.data.voidedAt.toISOString(), voidedBy: payment.data.voidedBy } : {}) };
}

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapAggregate(row: DbAggregate, operation = "get_order_aggregate"): OrderAggregate {
  if (!isCurrency(row.currency) || !row.items.length ||
    row.items.some((item) => item.quantity <= 0n || item.quantity > BigInt(Number.MAX_SAFE_INTEGER)))
    throw new InvalidStoredOrderError("Invalid stored order identity or items");
  const delivery = row.delivery === null ? null : parseDeliverySnapshot(row.delivery);
  if (delivery !== null && !delivery.success) {
    log.error({ event: "order_delivery_stored_data_invalid", orderId: row.id, operation,
      stage: "load_order", errorCode: "INVALID_ORDER", reason: "invalid_snapshot_shape" }, "Stored order delivery is invalid");
    throw new InvalidStoredDeliveryError("Invalid stored order delivery");
  }
  if (row.deliveryStatus !== "pending" && row.deliveryStatus !== "shipped" && row.deliveryStatus !== "delivered") throw new InvalidStoredOrderError("Invalid stored delivery state");
  const items = row.items.map((item) => {
    const attributes = item.variantAttributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string"))
      throw new InvalidStoredOrderError("Invalid stored order attributes");
    return { id: item.id as OrderItemId, variantId: item.variantId as VariantId, productName: item.productName,
      variantAttributes: { ...attributes } as Record<string, string>, sku: item.sku, quantity: Number(item.quantity) as PositiveInteger,
      unitPrice: { amount: item.unitPrice.toNumber(), currency: row.currency }, subtotal: { amount: item.subtotal.toNumber(), currency: row.currency },
      mentionedPrice: item.mentionedPriceAmount === null || item.mentionedPriceUnits === null ? null
        : { amount: { amount: item.mentionedPriceAmount.toNumber(), currency: row.currency }, units: item.mentionedPriceUnits } };
  }) as [OrderAggregate["items"][number], ...OrderAggregate["items"][number][]];
  const payments: Payment[] = row.payments.map(mapPayment);
  const parsedDate = row.scheduledDispatchDate ? parseDispatchDate(row.scheduledDispatchDate.toISOString().slice(0, 10)) : null;
  if (parsedDate && !parsedDate.success) throw new InvalidStoredOrderError("Invalid stored dispatch date");
  const scheduledDispatchDate = parsedDate ? parsedDate.data : null;
  const number = parseOrderNumber(Number(row.number));
  if (!number.success) throw new InvalidStoredOrderError("Invalid stored order number");
  const order: OrderAggregate = { number: number.data, id: row.id as OrderId, companyId: row.companyId as CompanyId, sellerId: row.sellerId as UserId | null, fromCatalog: row.fromCatalog,
    buyer: row.buyer ? { contactId: row.buyer.contactId as ContactId | null, name: row.buyer.name, phone: row.buyer.phone } : null,
    ...(row.chatId ? { chatId: row.chatId as ChatId } : {}),
    checkoutEnabledAt: row.checkoutEnabledAt, checkoutConfirmedAt: row.checkoutConfirmedAt,
    createdAt: row.createdAt, scheduledDispatchDate, shippedAt: row.shippedAt, deliveredAt: row.deliveredAt, completedAt: row.completedAt, cancelled: row.cancelled, cancelledAt: row.cancelledAt, items, payments,
    delivery: delivery === null ? null : delivery.data, deliveryStatus: row.deliveryStatus, stockDeducted: row.stockDeducted, stockDeductedAt: row.stockDeductedAt,
    itemsTotal: { amount: row.itemsTotal.toNumber(), currency: row.currency },
    deliveryCost: { amount: row.deliveryCost.toNumber(), currency: row.currency },
    deliveryCharge: { amount: row.deliveryCharge.toNumber(), currency: row.currency },
    total: { amount: row.total.toNumber(), currency: row.currency } };
  const rebuilt = buildOrder({ id: order.id, companyId: order.companyId, sellerId: order.sellerId,
    customer: order.buyer?.contactId ? { kind: "contact", contactId: order.buyer.contactId, name: order.buyer.name, phone: order.buyer.phone } : { kind: "general_public" }, createdAt: order.createdAt, items: order.items });
  if (!rebuilt.success || rebuilt.data.total.amount !== order.itemsTotal.amount ||
    rebuilt.data.items.some((item, index) => item.subtotal.amount !== order.items[index]?.subtotal.amount))
    throw new InvalidStoredOrderError("Invalid stored order item totals");
  if (!checkoutState(order).success) throw new InvalidStoredOrderError("Invalid stored checkout state");
  if (!orderStateMachine.getLifecycle(order).success) throw new InvalidStoredOrderError("Invalid stored order state");
  return order;
}

type PendingOrderFailure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "ORDER_ALREADY_EXISTS"; message: string }>
  | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: string }>;
type SellerUnavailable = Readonly<{ code: "SELLER_UNAVAILABLE"; message: string }>;

/** Both columns or none: the database CHECK rejects a half-set price. */
function mentionedPriceColumns(price: OrderItem["mentionedPrice"]) {
  return price ? { mentionedPriceAmount: new Prisma.Decimal(price.amount.amount.toString()), mentionedPriceUnits: price.units }
    : { mentionedPriceAmount: null, mentionedPriceUnits: null };
}

/** A variant deleted between the sellable read and the item insert breaks the item's foreign key. */
function isMissingVariantViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003"
    && (JSON.stringify(cause.meta ?? {}) + cause.message).includes("OrderItem_companyId_variantId_fkey");
}

export function savePendingOrder(order: OrderAggregate): Promise<Result<null, PendingOrderFailure>>;
export function savePendingOrder(order: OrderAggregate, source: OrderChatSource): Promise<Result<null, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }> | SellerUnavailable>>;
export async function savePendingOrder(order: OrderAggregate, source?: OrderChatSource): Promise<Result<null, PendingOrderFailure | SellerUnavailable>> {
  const positions = new Map(order.items.map((item, position) => [item.id, position]));
  const items = [...order.items].sort((a, b) => a.variantId.localeCompare(b.variantId));
  let inserting: string | null = null;
  try {
    await prisma.order.create({ data: { number: BigInt(order.number), id: order.id, companyId: order.companyId, sellerId: order.sellerId, fromCatalog: order.fromCatalog,
      ...(source ? { chatId: source.chatId, customerId: source.customerId } : {}),
      buyer: order.buyer ? { create: { contactId: order.buyer.contactId, name: order.buyer.name, phone: order.buyer.phone } } : undefined,
      checkoutEnabledAt: order.checkoutEnabledAt, checkoutConfirmedAt: order.checkoutConfirmedAt,
      currency: order.total.currency, total: new Prisma.Decimal(order.total.amount.toString()),
      itemsTotal: new Prisma.Decimal(order.itemsTotal.amount.toString()),
      deliveryCost: new Prisma.Decimal(order.deliveryCost.amount.toString()),
      deliveryCharge: new Prisma.Decimal(order.deliveryCharge.amount.toString()),
      delivery: Prisma.JsonNull,
      deliveryStatus: order.deliveryStatus, stockDeducted: order.stockDeducted, stockDeductedAt: order.stockDeductedAt, cancelled: order.cancelled, cancelledAt: order.cancelledAt,
      createdAt: order.createdAt, scheduledDispatchDate: order.scheduledDispatchDate && new Date(order.scheduledDispatchDate), shippedAt: order.shippedAt, deliveredAt: order.deliveredAt, completedAt: order.completedAt,

    } });
    // One insert per item, sorted by variant: each takes a key-share lock on its variant, and a rekeying product save locks variant rows
    // in the same order, so the two never wait on each other in a cycle. The failing insert also names the missing variant.
    for (const item of items) {
      inserting = item.variantId;
      await prisma.orderItem.create({ data: { id: item.id, orderId: order.id, companyId: order.companyId, variantId: item.variantId, productName: item.productName,
        variantAttributes: item.variantAttributes as Prisma.InputJsonObject, sku: item.sku, position: positions.get(item.id) ?? 0, quantity: BigInt(item.quantity),
        unitPrice: new Prisma.Decimal(item.unitPrice.amount.toString()), subtotal: new Prisma.Decimal(item.subtotal.amount.toString()),
        ...mentionedPriceColumns(item.mentionedPrice) } });
    }
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (inserting && isMissingVariantViolation(cause)) {
      const message = "Variant is not available";
      // A message-to-order scan that raced a deletion is retried like any transient failure: the next scan no longer finds the variant.
      return source ? err({ code: "PERSISTENCE_UNAVAILABLE" as const, message }) : err({ code: "VARIANT_NOT_FOUND" as const, message, variantId: inserting });
    }
    if (source && cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003" && JSON.stringify(cause.meta ?? {}).includes("Order_companyId_sellerId_fkey"))
      return err({ code: "SELLER_UNAVAILABLE" as const, message: "Seller is not available" });
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const target = cause.meta?.target;
      const adapterConstraint = z.object({ driverAdapterError: z.object({ cause: z.object({
        constraint: z.object({ index: z.string() }),
      }) }) }).safeParse(cause.meta);
      if ((Array.isArray(target) && target.includes("number")) || target === "Order_companyId_number_key" ||
        (adapterConstraint.success && adapterConstraint.data.driverAdapterError.cause.constraint.index === "Order_companyId_number_key")) {
        log.error({ event: "unable_to_save_pending_order", operation: "create_order", errorCode: "ORDER_NUMBER_CONFLICT", err: cause }, "Unable to save pending order");
        return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order" });
      }
      // Un ID generado por el caso de uso no colisiona: tratarlo como fallo reintentable.
      return source ? err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order" }) : err({ code: "ORDER_ALREADY_EXISTS" as const, message: "Order already exists" });
    }
    log.error({ event: "unable_to_save_pending_order", err: cause }, "unable_to_save_pending_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save pending order" });
  }
}

/** One statement on the unique `(companyId, id)` index; nothing about the order is logged, because its id is a checkout credential. */
export async function readCatalogOrderConfirmation(companyId: CompanyId, orderId: OrderId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const row = await prisma.order.findFirst({ where: { companyId, id: orderId, fromCatalog: true }, select: { checkoutConfirmedAt: true } });
    return ok(row?.checkoutConfirmedAt ? "confirmed" as const : "not_confirmed" as const);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_check_cart_order", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_check_cart_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to check cart order" });
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

export async function findOrderAggregate(id: OrderId, companyId: CompanyId, operation = "get_order_aggregate") {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const row = await prisma.order.findFirst({ where: { id, companyId }, include: aggregateInclude });
    return ok(row ? mapAggregate(row, operation) : null);
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) {
      if (!(cause instanceof InvalidStoredDeliveryError)) log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_STORED_ORDER", err: cause }, "Invalid stored order");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_order_aggregate", operation, orderId: id, stage: "load_order", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_load_order_aggregate");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load order aggregate" });
  }
}

/** The company's orders among these ids in one query (unknown ids are absent); catalog orders still awaiting buyer confirmation are not visible. */
export async function findOrderAggregatesByIds(ids: readonly OrderId[], companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const rows = await prisma.order.findMany({ where: { companyId, id: { in: [...ids] }, NOT: { fromCatalog: true, checkoutConfirmedAt: null } }, include: aggregateInclude });
    return ok(rows.map((row) => mapAggregate(row, "read_orders_by_ids")));
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) {
      if (!(cause instanceof InvalidStoredDeliveryError)) log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_STORED_ORDER", err: cause }, "Invalid stored order");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_orders_by_ids", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_load_orders_by_ids");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load orders" });
  }
}

export async function findOrderForUpdate(id: OrderId, companyId: CompanyId, operation?: string) {
  requireActiveTransaction(companyId);
  try {
    const started = performance.now();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Order" WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    if (rows.length && (operation === "set_order_delivery" || operation === "edit_order")) log.debug({ event: "delivery_lock_acquired", operation, orderId: id,
      lockTarget: "order", lockMode: "exclusive", lockWaitMs: Math.round(performance.now() - started) }, "Order delivery lock acquired");
    return rows.length ? findOrderAggregate(id, companyId, operation) : ok(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_lock_order", operation, orderId: id, stage: "lock_order", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_lock_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to lock order" });
  }
}

/** The deduction time is written once: a time already stored (the first deduction) is never moved. */
export async function saveStockDeduction(id: OrderId, companyId: CompanyId, stockDeductedAt: Date, operation?: string) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.$executeRaw`UPDATE "Order" SET "stockDeducted" = true, "stockDeductedAt" = COALESCE("stockDeductedAt", ${stockDeductedAt}::timestamptz)
      WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "stockDeducted" = false`;
    if (updated !== 1) throw new Error("Locked order was not available for stock deduction");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_stock_deduction", operation, orderId: id, stage: "save_stock_deduction", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_stock_deduction");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save stock deduction" });
  }
}

export async function savePayment(payment: Payment, companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    await prisma.payment.create({ data: { id: payment.id, companyId, orderId: payment.orderId,
      status: payment.status, amount: payment.amount ? new Prisma.Decimal(payment.amount.amount.toString()) : null,
      currency: payment.amount ? payment.amount.currency : payment.currency,
      method: payment.method, walletProvider: payment.walletProvider ?? null, deductStockIfPartial: stockRequested(payment), data: paymentDataJson(payment) } });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002")
      return err({ code: "PAYMENT_CONFLICT" as const, message: "Payment ID already exists" });
    log.error({ event: "unable_to_save_payment", err: cause }, "unable_to_save_payment");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save payment" });
  }
}

export async function updatePayment(payment: Payment, companyId: CompanyId, expectedStatus: "reported" | "confirmed") {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.payment.updateMany({ where: { id: payment.id, orderId: payment.orderId, companyId, status: expectedStatus },
      data: { status: payment.status, amount: payment.amount ? new Prisma.Decimal(payment.amount.amount.toString()) : null,
        method: payment.method, walletProvider: payment.walletProvider ?? null, deductStockIfPartial: stockRequested(payment), data: paymentDataJson(payment) } });
    return updated.count === 1 ? ok<null>(null) : err({ code: "PAYMENT_CONFLICT" as const, message: "Payment changed during update" });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_update_payment", err: cause }, "unable_to_update_payment");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to update payment" });
  }
}

export async function saveCompletion(id: OrderId, companyId: CompanyId, completedAt: Date | null) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, deliveryStatus: "delivered", cancelled: false },
      data: { completedAt } });
    return updated.count === 1 ? ok<null>(null) : err({ code: "INVALID_ORDER" as const, message: "Delivered order changed during update" });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_order_completion", err: cause }, "unable_to_save_order_completion");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order completion" });
  }
}

export async function saveDispatchSchedule(id: OrderId, companyId: CompanyId, change: DispatchScheduleChange) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, cancelled: false, deliveryStatus: "pending" },
      data: { scheduledDispatchDate: change.scheduledDispatchDate && new Date(change.scheduledDispatchDate) } });
    if (updated.count !== 1) throw new Error("Locked order was not available for scheduling");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_dispatch_schedule", err: cause }, "unable_to_save_dispatch_schedule");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save dispatch schedule" });
  }
}

export async function saveFulfillment(id: OrderId, companyId: CompanyId, change: FulfillmentChange) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, cancelled: false, stockDeducted: true,
      deliveryStatus: change.deliveryStatus === "shipped" ? "pending" : { in: ["pending", "shipped"] } },
    data: { deliveryStatus: change.deliveryStatus, shippedAt: change.shippedAt, deliveredAt: change.deliveredAt, completedAt: change.completedAt } });
    if (updated.count !== 1) throw new Error("Locked order was not available for fulfillment");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_fulfillment", err: cause }, "unable_to_save_fulfillment");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save fulfillment" });
  }
}

export async function saveCancellation(id: OrderId, companyId: CompanyId, cancelledAt: Date) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, deliveryStatus: "pending", cancelled: false, completedAt: null },
      data: { cancelled: true, cancelledAt } });
    if (updated.count !== 1) throw new Error("Locked order was not available for cancellation");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_order_cancellation", err: cause }, "unable_to_save_order_cancellation");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order cancellation" });
  }
}

export async function saveStockRestoration(id: OrderId, companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    const updated = await prisma.order.updateMany({ where: { id, companyId, cancelled: true, stockDeducted: true }, data: { stockDeducted: false } });
    if (updated.count !== 1) throw new Error("Locked cancelled order was not available for restoration");
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_stock_restoration", err: cause }, "Unable to save stock restoration");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save stock restoration" });
  }
}

export async function saveDelivery(id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) {
  requireActiveTransaction(companyId);
  if (change.delivery === null || !parseDeliverySnapshot(change.delivery).success) throw new Error("Invalid delivery snapshot");
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
    log.error({ event: "unable_to_save_order_delivery", operation: "set_order_delivery", orderId: id, deliveryMethod: change.delivery?.method,
      stage: "save_delivery", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_order_delivery");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order delivery" });
  }
}

export async function findOrders(criteria: OrderCriteria) {
  const where: Prisma.OrderWhereInput = {
    companyId: getCompanyId(),
    ...(criteria.customer.kind === "general_public" ? { buyer: { is: null } } : {}),
    NOT: { fromCatalog: true, checkoutConfirmedAt: null },
    completedAt: { not: null, ...(criteria.completedFrom ? { gte: criteria.completedFrom } : {}), ...(criteria.completedBefore ? { lt: criteria.completedBefore } : {}) },
  };
  try {
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: [{ completedAt: "desc" }, { id: "asc" }], skip: (criteria.page - 1) * 20, take: 20,
        select: { number: true, id: true, completedAt: true, buyer: true, chatId: true, fromCatalog: true, sellerId: true, currency: true, total: true } }),
      prisma.order.count({ where }),
    ]);
    return ok({ items: rows.map((row) => {
      if (!row.completedAt || !isCurrency(row.currency))
        throw new InvalidStoredOrderError("Invalid stored order summary");
      return { number: storedNumber(row.number), id: row.id, completedAt: row.completedAt, sellerId: row.sellerId,
        buyer: row.buyer ? { contactId: row.buyer.contactId, name: row.buyer.name, phone: row.buyer.phone } : null,
        source: orderSource(row),
        total: { amount: row.total.toNumber(), currency: row.currency } };
    }), page: criteria.page, pageSize: 20, total });
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) {
      if (!(cause instanceof InvalidStoredDeliveryError)) log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_STORED_ORDER", err: cause }, "Invalid stored order");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_list_orders", err: cause }, "unable_to_list_orders");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list orders" });
  }
}

/** Sum of the confirmed payments of an order aliased `o`. */
const confirmedPaid = Prisma.sql`coalesce((SELECT sum(p.amount) FROM "Payment" p WHERE p."orderId" = o.id
  AND p."companyId" = o."companyId" AND p.status = 'confirmed'), 0)`;
/** Unconfirmed catalog orders do not exist for the seller. */
const visibleOrder = Prisma.sql`NOT (o."fromCatalog" AND o."checkoutConfirmedAt" IS NULL)`;

export async function findOrderAggregates(criteria: AggregateCriteria, companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  const predicates = [Prisma.sql`o."companyId" = ${companyId}::uuid`, visibleOrder];
  if (criteria.cancelled === "exclude") predicates.push(Prisma.sql`o.cancelled = false`);
  if (criteria.customer.kind === "general_public") predicates.push(Prisma.sql`b."orderId" IS NULL`);
  if (criteria.createdFrom) predicates.push(Prisma.sql`o."createdAt" >= ${criteria.createdFrom}`);
  if (criteria.createdBefore) predicates.push(Prisma.sql`o."createdAt" < ${criteria.createdBefore}`);
  if (criteria.deliveryStatus) predicates.push(Prisma.sql`o."deliveryStatus" = ${criteria.deliveryStatus}`);
  if (criteria.deliveryStatus === "pending") predicates.push(Prisma.sql`o.cancelled = false`);
  if (criteria.courierId) predicates.push(Prisma.sql`o.delivery -> 'courier' ->> 'id' = ${criteria.courierId}`);
  const scheduled = criteria.scheduled;
  if (scheduled?.kind === "unscheduled") predicates.push(Prisma.sql`o."scheduledDispatchDate" IS NULL`);
  if (scheduled && "from" in scheduled) predicates.push(Prisma.sql`o."scheduledDispatchDate" >= ${scheduled.from}::date`);
  if (scheduled && "through" in scheduled) predicates.push(Prisma.sql`o."scheduledDispatchDate" <= ${scheduled.through}::date`);
  if (criteria.shippedFrom) predicates.push(Prisma.sql`o."shippedAt" >= ${criteria.shippedFrom}`);
  if (criteria.shippedBefore) predicates.push(Prisma.sql`o."shippedAt" < ${criteria.shippedBefore}`);
  if (criteria.search) {
    const number = /^#?\d+$/.test(criteria.search) ? Number(criteria.search.replace(/^#/, "")) : NaN;
    const byNumber = Number.isSafeInteger(number) ? Prisma.sql`o.number = ${BigInt(number)}` : Prisma.sql`false`;
    if (criteria.searchPhone === "exclude") {
      // Assistant search: digits never match a customer name, so a hidden phone cannot be rebuilt by probing. A query with any numeric character searches the order number only.
      predicates.push(/\p{N}/u.test(criteria.search.normalize("NFKC")) ? byNumber : Prisma.sql`strpos(lower(coalesce(b.name, '')), lower(${criteria.search})) > 0`);
    } else {
      predicates.push(Prisma.sql`(strpos(lower(coalesce(b.name, '')), lower(${criteria.search})) > 0 OR strpos(b.phone, ${criteria.search}) > 0
        ${Number.isSafeInteger(number) ? Prisma.sql`OR o.number = ${BigInt(number)}` : Prisma.empty})`);
    }
  }
  if (criteria.view === "unpaid") predicates.push(Prisma.sql`o.cancelled = false AND ${confirmedPaid} < o.total`);
  if (criteria.view === "paid") predicates.push(Prisma.sql`o.cancelled = false AND ${confirmedPaid} >= o.total`);
  if (criteria.view === "undelivered") predicates.push(Prisma.sql`o.cancelled = false AND o."deliveryStatus" IN ('pending', 'shipped')`);
  try {
    const [page] = await prisma.$queryRaw<{ ids: string[]; total: number }[]>(Prisma.sql`
      WITH matching AS (SELECT o.id, o."createdAt" FROM "Order" o
        LEFT JOIN "OrderBuyer" b ON b."orderId" = o.id AND b."companyId" = o."companyId"
        WHERE ${Prisma.join(predicates, " AND ")})
      SELECT ARRAY(SELECT id FROM matching ORDER BY "createdAt" DESC, id ASC
        LIMIT 20 OFFSET ${(criteria.page - 1) * 20}) AS ids,
        (SELECT count(*)::int FROM matching) AS total`);
    const rows = await prisma.order.findMany({ where: { companyId, id: { in: page.ids } },
      include: aggregateInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    const total = page.total;
    return ok<AggregatePage>({ items: rows.map((row) => mapAggregate(row, "list_order_aggregates")), page: criteria.page, pageSize: 20, total });
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) {
      if (!(cause instanceof InvalidStoredDeliveryError)) log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_STORED_ORDER", err: cause }, "Invalid stored order");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_list_order_aggregates", err: cause }, "unable_to_list_order_aggregates");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list orders" });
  }
}

/** The company's order with this number, with its derived state; the caller's composition hides unconfirmed catalog orders. */
export async function findOrderAggregateByNumber(number: OrderNumber, companyId: CompanyId, operation = "get_order_aggregate_by_number") {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const row = await prisma.order.findFirst({ where: { companyId, number: BigInt(number) }, include: aggregateInclude });
    return ok(row ? mapAggregate(row, operation) : null);
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) {
      if (!(cause instanceof InvalidStoredDeliveryError)) log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_STORED_ORDER", err: cause }, "Invalid stored order");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_load_order_by_number", operation, orderNumber: number, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_load_order_by_number");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to load order" });
  }
}

/** Whether the company has an order the seller can see. */
export async function existsOrder(companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const [row] = await prisma.$queryRaw<{ found: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM "Order" o WHERE o."companyId" = ${companyId}::uuid AND ${visibleOrder}) AS found`);
    return ok(row?.found === true);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_check_any_order", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_check_any_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to check orders" });
  }
}

const unpaidSummaryRow = z.object({ currency: z.string(), count: z.number().int().nonnegative(), pendingReports: z.number().int().nonnegative(), owed: z.string().regex(/^\d+(\.\d+)?$/) });

/** One aggregate over every unpaid order (the `unpaid` view's predicate): count, balance per currency and how many have a payment report waiting. */
export async function summarizeUnpaidOrders(companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    // Payments are grouped once and hash-joined: a correlated sum per order costs about 2.5x more at 50 000 orders.
    const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`WITH paid AS (SELECT p."orderId", coalesce(sum(p.amount) FILTER (WHERE p.status = 'confirmed'), 0) AS confirmed,
        coalesce(bool_or(p.status = 'reported'), false) AS reported FROM "Payment" p WHERE p."companyId" = ${companyId}::uuid GROUP BY p."orderId")
      SELECT o.currency, count(*)::int AS count, (count(*) FILTER (WHERE coalesce(c.reported, false)))::int AS "pendingReports", sum(o.total - coalesce(c.confirmed, 0))::text AS owed
      FROM "Order" o LEFT JOIN paid c ON c."orderId" = o.id
      WHERE o."companyId" = ${companyId}::uuid AND ${visibleOrder} AND o.cancelled = false AND coalesce(c.confirmed, 0) < o.total
      GROUP BY o.currency ORDER BY o.currency`);
    const parsed = z.array(unpaidSummaryRow).safeParse(rows);
    if (!parsed.success || parsed.data.some((row) => !isCurrency(row.currency))) {
      log.error({ event: "unpaid_summary_invalid_row", errorCode: "INVALID_STORED_ORDER" }, "Invalid unpaid summary row");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    const owed: Money[] = parsed.data.map((row) => ({ amount: Number(row.owed), currency: row.currency as Money["currency"] }));
    return ok<UnpaidSummary>({ count: parsed.data.reduce((sum, row) => sum + row.count, 0), withPendingReport: parsed.data.reduce((sum, row) => sum + row.pendingReports, 0), owed });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_summarize_unpaid_orders", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_summarize_unpaid_orders");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to summarize unpaid orders" });
  }
}

const dispatchCandidateRow = z.object({
  id: z.uuid(), number: z.string().regex(/^\d+$/), createdAt: z.date(), scheduledDispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), stockDeducted: z.boolean(),
  total: z.string().regex(/^\d+(\.\d+)?$/), currency: z.string(), method: z.enum(["home", "agency", "store"]).nullable(), hasReportedPayment: z.boolean(),
  items: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().positive().safe() })).min(1),
  payments: z.array(z.object({ amount: z.number().positive().finite(), currency: z.string(), deductStockIfPartial: z.boolean() })),
});

/**
 * Pending, not cancelled orders scheduled through `through`, oldest date first, as light rows (items and confirmed payments aggregated in SQL).
 * `"too_many"` when more than `max` match. The `Order_dispatch_queue_idx` predicate is repeated with literals so a generic plan can use the partial index.
 */
export async function findDispatchCandidates(through: DispatchDate, max: number, companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const raw = await prisma.$queryRaw<unknown[]>(Prisma.sql`SELECT o.id, o.number::text AS number, o."createdAt", o."scheduledDispatchDate"::text AS "scheduledDispatchDate",
      o."stockDeducted", o.total::text AS total, o.currency, o.delivery ->> 'method' AS method, pay.reported AS "hasReportedPayment",
      (SELECT coalesce(json_agg(json_build_object('variantId', i."variantId", 'quantity', i.quantity) ORDER BY i.id), '[]'::json)
         FROM "OrderItem" i WHERE i."companyId" = o."companyId" AND i."orderId" = o.id) AS items,
      pay.confirmed AS payments
      FROM "Order" o
      CROSS JOIN LATERAL (SELECT coalesce(json_agg(json_build_object('amount', p.amount, 'currency', p.currency, 'deductStockIfPartial', p."deductStockIfPartial") ORDER BY p.id)
          FILTER (WHERE p.status = 'confirmed'), '[]'::json) AS confirmed, coalesce(bool_or(p.status = 'reported'), false) AS reported
        FROM "Payment" p WHERE p."companyId" = o."companyId" AND p."orderId" = o.id) pay
      WHERE o."companyId" = ${companyId}::uuid AND NOT o.cancelled AND o."deliveryStatus" = 'pending'
        AND o."scheduledDispatchDate" <= ${through}::date AND ${visibleOrder}
      ORDER BY o."scheduledDispatchDate", o.number LIMIT ${max + 1}`);
    if (raw.length > max) return ok<readonly DispatchCandidate[] | "too_many">("too_many");
    const candidates = raw.map((row): DispatchCandidate => {
      const parsed = dispatchCandidateRow.safeParse(row);
      const [first, ...rest] = parsed.success ? parsed.data.items : [];
      const number = parsed.success ? parseOrderNumber(Number(parsed.data.number)) : null;
      const date = parsed.success ? parseDispatchDate(parsed.data.scheduledDispatchDate) : null;
      if (!parsed.success || !first || !number?.success || !date?.success || !isCurrency(parsed.data.currency) || parsed.data.payments.some((payment) => payment.currency !== parsed.data.currency))
        throw new InvalidStoredOrderError("Invalid stored dispatch candidate");
      const currency = parsed.data.currency;
      const line = (item: typeof first) => ({ variantId: item.variantId as VariantId, quantity: item.quantity as PositiveInteger });
      return { id: parsed.data.id as OrderId, createdAt: parsed.data.createdAt, cancelled: false, stockDeducted: parsed.data.stockDeducted, deliveryStatus: "pending",
        total: { amount: Number(parsed.data.total), currency }, items: [line(first), ...rest.map(line)],
        confirmedPayments: parsed.data.payments.map((payment) => ({ amount: { amount: payment.amount, currency }, deductStockIfPartial: payment.deductStockIfPartial })),
        number: number.data, scheduledDispatchDate: date.data, deliveryMethod: parsed.data.method, hasReportedPayment: parsed.data.hasReportedPayment };
    });
    return ok<readonly DispatchCandidate[] | "too_many">(candidates);
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) {
      log.error({ event: "dispatch_candidate_invalid", errorCode: "INVALID_STORED_ORDER", err: cause }, "Invalid stored dispatch candidate");
      return err({ code: "INVALID_ORDER" as const, message: "Invalid stored order" });
    }
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_dispatch_candidates", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_dispatch_candidates");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read the dispatch queue" });
  }
}

/** Pending orders with no scheduled dispatch date; same index and literal predicate as `findDispatchCandidates`. */
export async function countUndatedPendingOrders(companyId: CompanyId) {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const [row] = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count FROM "Order" o
      WHERE o."companyId" = ${companyId}::uuid AND NOT o.cancelled AND o."deliveryStatus" = 'pending' AND o."scheduledDispatchDate" IS NULL AND ${visibleOrder}`);
    return ok(row?.count ?? 0);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_count_undated_pending_orders", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_count_undated_pending_orders");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to count undated orders" });
  }
}

function storedNumber(value: bigint): OrderNumber {
  const parsed = parseOrderNumber(Number(value));
  if (!parsed.success) throw new InvalidStoredOrderError("Invalid stored order number");
  return parsed.data;
}

export async function allocateOrderNumber(companyId: CompanyId) {
  requireActiveTransaction(companyId);
  try {
    const rows = await prisma.$queryRaw<Array<{ number: bigint }>>`UPDATE "Company" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE id = ${companyId}::uuid AND "nextOrderNumber" <= 9007199254740991 RETURNING "nextOrderNumber" - 1 AS number`;
    if (!rows.length) {
      log.error({ event: "unable_to_allocate_order_number", operation: "create_order", errorCode: "ORDER_NUMBER_EXHAUSTED" }, "Unable to allocate order number");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to allocate order number" });
    }
    return ok(storedNumber(rows[0].number));
  } catch (cause) {
    if (!knownFailure(cause) && !(cause instanceof InvalidStoredOrderError)) throw cause;
    log.error({ event: "unable_to_allocate_order_number", operation: "create_order", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to allocate order number");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to allocate order number" });
  }
}

/** Most recent order of the chat that still accepts items; mirrors `isOpenForMessageItems` and is re-checked after locking. */
export async function findOpenChatOrderCandidate(chatId: ChatId) {
  const companyId = getCompanyId();
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT o.id FROM "Order" o
      WHERE o."companyId" = ${companyId}::uuid AND o."chatId" = ${chatId}::uuid
        AND o.cancelled = false AND o."completedAt" IS NULL AND o."checkoutConfirmedAt" IS NULL
        AND o."deliveryStatus" = 'pending' AND o."stockDeducted" = false
        AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p."companyId" = o."companyId" AND p.status IN ('confirmed', 'reported'))
      ORDER BY o."createdAt" DESC, o.number DESC LIMIT 1`;
    return ok(rows[0] ? rows[0].id as OrderId : null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_open_chat_order", err: cause }, "unable_to_find_open_chat_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to find open chat order" });
  }
}

type ItemChangesFailure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }> | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: VariantId }>;

/**
 * Applies the row changes of an item edit to the locked order and stores its recalculated totals, in a fixed number of statements:
 * one delete, one update of every changed quantity, one insert of the added items, one update of the line positions and the totals.
 */
export async function saveItemChanges(order: OrderAggregate, changes: OrderItemChanges): Promise<Result<null, ItemChangesFailure>> {
  requireActiveTransaction(order.companyId);
  const money = (value: number) => new Prisma.Decimal(value.toString());
  const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });
  try {
    // Removals first: a replaced variant frees its (order, variant) pair for the item that takes its place.
    if (changes.removedItemIds.length) await prisma.orderItem.deleteMany({ where: { orderId: order.id, id: { in: [...changes.removedItemIds] } } });
    if (changes.updated.length) {
      const values = Prisma.join(changes.updated.map((item) => Prisma.sql`(${item.id}::uuid, ${BigInt(item.quantity)}::bigint, ${money(item.subtotal.amount).toString()}::numeric(15,2),
        ${item.mentionedPrice ? money(item.mentionedPrice.amount.amount).toString() : null}::numeric(11,2), ${item.mentionedPrice?.units ?? null}::int)`));
      const count = await prisma.$executeRaw`UPDATE "OrderItem" i SET quantity = v.quantity, subtotal = v.subtotal, "mentionedPriceAmount" = v.amount, "mentionedPriceUnits" = v.units
        FROM (VALUES ${values}) AS v(id, quantity, subtotal, amount, units)
        WHERE i.id = v.id AND i."orderId" = ${order.id}::uuid AND i."companyId" = ${order.companyId}::uuid`;
      if (count !== changes.updated.length) {
        log.error({ event: "unable_to_save_item_changes", orderId: order.id, errorCode: "UNEXPECTED_ROW_COUNT" }, "unable_to_save_item_changes");
        return unavailable("Unable to save item changes");
      }
    }
    // Inserts take their locks on the variants in a fixed order, so two concurrent additions cannot wait for each other.
    const inserts = [...changes.added].sort((a, b) => a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0);
    if (inserts.length) {
      // The driver does not expose the key detail of a foreign-key violation, so the variants are locked (KEY SHARE, in id order, as the inserts would)
      // and the first one that is gone is named before the insert; the violation below only remains for a company mismatch.
      const ids = inserts.map((item) => item.variantId);
      const present = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "ProductVariant" WHERE id = ANY(${ids}::uuid[]) AND "companyId" = ${order.companyId}::uuid ORDER BY id FOR KEY SHARE`;
      const found = new Set(present.map((row) => row.id));
      const missing = ids.find((id) => !found.has(id));
      if (missing) return err({ code: "VARIANT_NOT_FOUND" as const, message: "Variant is not available", variantId: missing as VariantId });
    }
    if (inserts.length) await prisma.orderItem.createMany({ data: inserts.map((item) => ({ id: item.id, orderId: order.id, variantId: item.variantId, productName: item.productName,
      variantAttributes: item.variantAttributes as Prisma.InputJsonObject, sku: item.sku, quantity: BigInt(item.quantity),
      unitPrice: money(item.unitPrice.amount), subtotal: money(item.subtotal.amount), ...mentionedPriceColumns(item.mentionedPrice) })) });
    // The lines keep the order the seller entered them in: the stored position follows the order of the aggregate.
    const places = Prisma.join(order.items.map((item, position) => Prisma.sql`(${item.id}::uuid, ${position}::int)`));
    await prisma.$executeRaw`UPDATE "OrderItem" i SET "position" = v.position FROM (VALUES ${places}) AS v(id, position)
      WHERE i.id = v.id AND i."orderId" = ${order.id}::uuid AND i."companyId" = ${order.companyId}::uuid AND i."position" <> v.position`;
    const updated = await prisma.order.updateMany({ where: { id: order.id, companyId: order.companyId, cancelled: false },
      data: { itemsTotal: money(order.itemsTotal.amount), total: money(order.total.amount) } });
    if (updated.count !== 1) throw new Error("Locked order was not available for item changes");
    return ok(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (isMissingVariantViolation(cause)) return unavailable("Variant is not available");
    log.error({ event: "unable_to_save_item_changes", orderId: order.id, err: cause }, "unable_to_save_item_changes");
    return unavailable("Unable to save item changes");
  }
}

/** Sets or replaces the order's buyer (nulls included), or removes the row when the order has no buyer left. */
export async function saveOrderCustomer(id: OrderId, companyId: CompanyId, buyer: OrderBuyer | null): Promise<Result<null, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  requireActiveTransaction(companyId);
  try {
    if (buyer) await prisma.orderBuyer.upsert({ where: { companyId_orderId: { companyId, orderId: id } },
      create: { companyId, orderId: id, contactId: buyer.contactId, name: buyer.name, phone: buyer.phone },
      update: { contactId: buyer.contactId, name: buyer.name, phone: buyer.phone } });
    else await prisma.orderBuyer.deleteMany({ where: { companyId, orderId: id } });
    return ok(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_order_customer", orderId: id, err: cause }, "unable_to_save_order_customer");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save order customer" });
  }
}

type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type FindProductIds = (variantIds: readonly VariantId[]) => Promise<Result<ReadonlyMap<VariantId, ProductId>, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>>;

/**
 * The state of the chat's order under lock: the open order with the product of every item, or why there is none.
 * `findProductIds` is the products capability that names the product of each item's variant.
 */
export function findChatOrderTargetForUpdate(chatId: ChatId, findProductIds: FindProductIds) {
  return readChatOrderTarget(chatId, findProductIds, true);
}

/** The same target without locks: what the reader sees. The transaction reads it again under lock. */
export function findChatOrderTarget(chatId: ChatId, findProductIds: FindProductIds) {
  return readChatOrderTarget(chatId, findProductIds, false);
}

async function readChatOrderTarget(chatId: ChatId, findProductIds: FindProductIds, lock: boolean) {
  const companyId = getCompanyId();
  const candidate = await findOpenChatOrderCandidate(chatId);
  if (!candidate.success) return candidate;
  if (candidate.data) {
    const found = lock ? await findOrderForUpdate(candidate.data, companyId as CompanyId) : await findOrderAggregate(candidate.data, companyId as CompanyId, "apply_chat_message");
    if (!found.success) return found.error.code === "PERSISTENCE_UNAVAILABLE" ? err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: found.error.message })
      : err<InvalidStoredData>({ code: "INVALID_STORED_DATA", message: "Invalid stored chat order" });
    if (found.data && isOpenForMessageItems(found.data, chatId)) {
      const productIds = await findProductIds(found.data.items.map((item) => item.variantId));
      if (!productIds.success) return productIds;
      if (found.data.items.some((item) => !productIds.data.has(item.variantId))) return err<InvalidStoredData>({ code: "INVALID_STORED_DATA", message: "Order item without product" });
      return ok<ChatOrderTarget>({ kind: "open", order: found.data, productIds: productIds.data });
    }
  }
  return findLatestChatOrderState(chatId, companyId as CompanyId);
}

/** At most this many orders come back from `findChatOrdersOpenedSince`: the earliest ones, which are the ones a pending joins. */
const maxOrdersOpenedSince = 20;

/**
 * The aggregates of the chat's orders that may have opened for messages after `since`: created after it, or with a payment voided after it.
 * The earliest `maxOrdersOpenedSince` by that time come back, ordered by it, because a pending joins the earliest interval that starts after its last change.
 */
export async function findChatOrdersOpenedSince(chatId: ChatId, since: Date) {
  const companyId = getCompanyId();
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT o.id FROM "Order" o
      CROSS JOIN LATERAL (SELECT LEAST(
        CASE WHEN o."createdAt" > ${since} THEN o."createdAt" END,
        (SELECT min((p.data->>'voidedAt')::timestamptz) FROM "Payment" p
          WHERE p."companyId" = o."companyId" AND p."orderId" = o.id AND p.status = 'voided' AND (p.data->>'voidedAt')::timestamptz > ${since})
      ) AS "openedAt") opened
      WHERE o."companyId" = ${companyId}::uuid AND o."chatId" = ${chatId}::uuid AND opened."openedAt" IS NOT NULL
      ORDER BY opened."openedAt", o.id LIMIT ${maxOrdersOpenedSince + 1}`;
    if (rows.length > maxOrdersOpenedSince) log.warn({ event: "chat_orders_opened_since_capped", companyId, chatId, count: rows.length - 1 }, "chat_orders_opened_since_capped");
    const ids = rows.slice(0, maxOrdersOpenedSince).map(({ id }) => id as OrderId);
    if (!ids.length) return ok<readonly OrderAggregate[]>([]);
    const found = await prisma.order.findMany({ where: { companyId, id: { in: ids } }, include: aggregateInclude });
    const byId = new Map(found.map((row) => [row.id, row]));
    return ok<readonly OrderAggregate[]>(ids.flatMap((id) => { const row = byId.get(id); return row ? [mapAggregate(row, "apply_chat_message")] : []; }));
  } catch (cause) {
    if (cause instanceof InvalidStoredOrderError) return err<InvalidStoredData>({ code: "INVALID_STORED_DATA", message: "Invalid stored chat order" });
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_chat_orders_opened_since", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_chat_orders_opened_since");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to find chat orders opened since" });
  }
}

async function findLatestChatOrderState(chatId: ChatId, companyId: CompanyId) {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; number: bigint; cancelled: boolean }>>`SELECT id, number, cancelled FROM "Order"
      WHERE "companyId" = ${companyId}::uuid AND "chatId" = ${chatId}::uuid ORDER BY "createdAt" DESC, number DESC LIMIT 1`;
    const [latest] = rows;
    if (!latest) return ok<ChatOrderTarget>({ kind: "none" });
    if (latest.cancelled) return ok<ChatOrderTarget>({ kind: "cancelled" });
    const number = parseOrderNumber(Number(latest.number));
    if (!number.success) return err<InvalidStoredData>({ code: "INVALID_STORED_DATA", message: "Invalid stored order number" });
    return ok<ChatOrderTarget>({ kind: "closed", orderId: latest.id as OrderId, number: number.data });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_latest_chat_order", err: cause }, "unable_to_find_latest_chat_order");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to find chat order" });
  }
}

export async function recordProcessedMessage(orderId: OrderId, messageId: ChatMessageId) {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    await prisma.orderMessage.create({ data: { companyId, orderId, messageId, createdAt: new Date() } });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002")
      return err({ code: "MESSAGE_ALREADY_PROCESSED" as const, message: "Message already processed" });
    log.error({ event: "unable_to_record_processed_message", orderId, err: cause }, "unable_to_record_processed_message");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to record processed message" });
  }
}

/** The sequential numbers of the orders that exist, in one query; an order that was deleted is absent. */
export async function findOrderNumbers(ids: readonly OrderId[]) {
  if (ids.length === 0) return ok<ReadonlyMap<OrderId, number>>(new Map());
  try {
    const rows = await prisma.order.findMany({ where: { id: { in: [...ids] } }, select: { id: true, number: true } });
    return ok<ReadonlyMap<OrderId, number>>(new Map(rows.map((row) => [row.id as OrderId, Number(row.number)])));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_order_numbers", err: cause }, "unable_to_read_order_numbers");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read order numbers" });
  }
}


/**
 * The due-and-fit rule in SQL, for an order aliased `o`: the three stock queries and the definer function share it. Its first line repeats the
 * partial index predicate with the same literals, so PostgreSQL can prove `Order_undeducted_pending_idx` applies under a generic plan.
 */
const dueAndFit = Prisma.sql`NOT o."stockDeducted" AND NOT o.cancelled AND o."deliveryStatus" = 'pending'
  AND (
    (SELECT coalesce(sum(p.amount), 0) FROM "Payment" p
       WHERE p."companyId" = o."companyId" AND p."orderId" = o.id AND p.status = 'confirmed') >= o.total
    OR EXISTS (SELECT 1 FROM "Payment" p WHERE p."companyId" = o."companyId" AND p."orderId" = o.id
       AND p.status = 'confirmed' AND p."deductStockIfPartial")
  )
  AND NOT EXISTS (SELECT 1 FROM "OrderItem" i LEFT JOIN "ProductStock" s ON s."variantId" = i."variantId"
       WHERE i."companyId" = o."companyId" AND i."orderId" = o.id AND coalesce(s.quantity, 0) < i.quantity)`;

const stockOrderRow = z.object({
  id: z.uuid(), createdAt: z.date(), cancelled: z.boolean(), stockDeducted: z.boolean(), deliveryStatus: z.enum(["pending", "shipped", "delivered"]),
  total: z.string().regex(/^\d+(\.\d+)?$/), currency: z.string(),
  items: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().positive().safe() })).min(1),
  payments: z.array(z.object({ amount: z.number().positive().finite(), currency: z.string(), deductStockIfPartial: z.boolean() })),
});

/** One statement for any number of orders: core fields, items and confirmed payments aggregated per order. A row that does not validate comes back as `ok: false`, after the query, so it never aborts the transaction. */
export async function loadStockOrders(ids: readonly OrderId[], companyId: CompanyId): Promise<Result<readonly StockOrderRow[], TransactionEndingError | ContainedFailure>> {
  requireActiveTransaction(companyId);
  try {
    const rows = await prisma.$queryRaw<unknown[]>`SELECT o.id, o."createdAt", o.cancelled, o."stockDeducted", o."deliveryStatus", o.total::text AS total, o.currency,
      (SELECT coalesce(json_agg(json_build_object('variantId', i."variantId", 'quantity', i.quantity) ORDER BY i.id), '[]'::json)
         FROM "OrderItem" i WHERE i."companyId" = o."companyId" AND i."orderId" = o.id) AS items,
      (SELECT coalesce(json_agg(json_build_object('amount', p.amount, 'currency', p.currency, 'deductStockIfPartial', p."deductStockIfPartial") ORDER BY p.id), '[]'::json)
         FROM "Payment" p WHERE p."companyId" = o."companyId" AND p."orderId" = o.id AND p.status = 'confirmed') AS payments
      FROM "Order" o WHERE o."companyId" = ${companyId}::uuid AND o.id = ANY(${[...ids]}::uuid[])`;
    return ok(rows.map((raw): StockOrderRow => {
      const id = (raw as { id: string }).id as OrderId;
      const parsed = stockOrderRow.safeParse(raw);
      const [first, ...rest] = parsed.success ? parsed.data.items : [];
      if (!parsed.success || !first || !isCurrency(parsed.data.currency) || parsed.data.payments.some((payment) => payment.currency !== parsed.data.currency)) return { ok: false, id };
      const currency = parsed.data.currency;
      const line = (item: typeof first) => ({ variantId: item.variantId as VariantId, quantity: item.quantity as PositiveInteger });
      return { ok: true, order: { id, createdAt: parsed.data.createdAt, cancelled: parsed.data.cancelled, stockDeducted: parsed.data.stockDeducted,
        deliveryStatus: parsed.data.deliveryStatus, total: { amount: Number(parsed.data.total), currency }, items: [line(first), ...rest.map(line)],
        confirmedPayments: parsed.data.payments.map((payment) => ({ amount: { amount: payment.amount, currency }, deductStockIfPartial: payment.deductStockIfPartial })) } };
    }));
  } catch (cause) { return err(persistenceFailureResult(cause, "Unable to load orders for stock deduction")); }
}

/** Locks the orders not held elsewhere in one statement, oldest first. FOR NO KEY UPDATE: foreign-key inserts on the order are not blocked, mutual exclusion with FOR UPDATE holds. */
export async function lockOrdersSkipLocked(ids: readonly OrderId[], companyId: CompanyId): Promise<Result<readonly OrderId[], TransactionEndingError | ContainedFailure>> {
  requireActiveTransaction(companyId);
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE "companyId" = ${companyId}::uuid AND id = ANY(${[...ids]}::uuid[])
      ORDER BY "createdAt", id FOR NO KEY UPDATE SKIP LOCKED`;
    return ok(rows.map((row) => row.id as OrderId));
  } catch (cause) { return err(persistenceFailureResult(cause, "Unable to lock orders")); }
}

/** One statement; returns how many orders it marked (those still undeducted). A deduction time already stored (the first deduction) is never moved. */
export async function saveStockDeductions(ids: readonly OrderId[], companyId: CompanyId, stockDeductedAt: Date): Promise<Result<number, TransactionEndingError | ContainedFailure>> {
  requireActiveTransaction(companyId);
  try {
    return ok(await prisma.$executeRaw`UPDATE "Order" SET "stockDeducted" = true, "stockDeductedAt" = COALESCE("stockDeductedAt", ${stockDeductedAt}::timestamptz)
      WHERE "companyId" = ${companyId}::uuid AND id = ANY(${[...ids]}::uuid[]) AND NOT "stockDeducted"`);
  } catch (cause) { return err(persistenceFailureResult(cause, "Unable to save stock deductions")); }
}

/** Orders of the company with an item on one of these variants that are due and now fit, oldest first. Walks the partial index. */
export async function listWaitingOrderIds(companyId: CompanyId, variantIds: readonly VariantId[], limit: number): Promise<Result<readonly OrderId[], TransactionEndingError | ContainedFailure>> {
  requireActiveTransaction(companyId);
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT o.id FROM "Order" o WHERE o."companyId" = ${companyId}::uuid
      AND EXISTS (SELECT 1 FROM "OrderItem" w WHERE w."companyId" = o."companyId" AND w."orderId" = o.id AND w."variantId" = ANY(${[...variantIds]}::uuid[]))
      AND ${dueAndFit} ORDER BY o."createdAt", o.id LIMIT ${limit}`);
    return ok(rows.map((row) => row.id as OrderId));
  } catch (cause) { return err(persistenceFailureResult(cause, "Unable to list waiting orders")); }
}

export async function listOverdueOrderIds(companyId: CompanyId, limit: number, exclude: readonly OrderId[]) {
  requireActiveTransaction(companyId);
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT o.id FROM "Order" o WHERE o."companyId" = ${companyId}::uuid
      AND ${dueAndFit} AND o.id <> ALL(${[...exclude]}::uuid[]) ORDER BY o."createdAt", o.id LIMIT ${limit}`);
    return ok<readonly OrderId[]>(rows.map((row) => row.id as OrderId));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_list_overdue_stock_deductions", stage: "list_overdue_orders", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_list_overdue_stock_deductions");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list overdue stock deductions" });
  }
}

/** Definer function: returns only company ids, so each deduction still runs under RLS. */
export async function listCompaniesWithOverdueStockDeductions() {
  try {
    const rows = await systemPrisma.$queryRaw<{ companyId: string }[]>`SELECT public.list_companies_with_overdue_stock_deductions() AS "companyId"`;
    return ok(rows.map((row) => row.companyId as CompanyId));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "stock_deduction_recovery_failed", stage: "list_companies", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "stock_deduction_recovery_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to list companies with overdue stock deductions" });
  }
}
