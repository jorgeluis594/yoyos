import { applicationEventBus } from "@core/src/composition/event-bus";
import type { EventBusError, ScheduledJobHandler } from "@core/src/shared/events/application/contracts";
import { createCompleteOrder, type CreateCompleteOrderInput } from "@core/src/features/orders/application/create-complete-order";
import { enableOrderCheckout, getOrderCheckout, confirmOrderCheckout, confirmCheckoutDelivery, type CheckoutDependencies, type CheckoutPhotoError, type GetOrderCheckoutDependencies, type ConfirmOrderCheckoutInput, type ConfirmCheckoutDeliveryInput } from "@core/src/features/orders/application/checkout";
import { findCheckoutOrder, findCheckoutOrderForUpdate as findAnyCheckoutOrderForUpdate, saveCheckoutBuyer, saveCheckoutConfirmed } from "@core/src/features/orders/infrastructure/checkout-repository";
import { canAccessBuyerPayment, type CheckoutAccess, type CheckoutError } from "@core/src/features/orders/domain/checkout";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { isPersistenceFailure, type TransactionEndingError } from "@core/src/shared/infrastructure/persistence-error";
import { createInTransactionPublisher, type InTransactionRegistry } from "@core/src/shared/events/application/in-transaction-events";
import { recoverDueStockDeductions, STOCK_DEDUCTION_FAILURE_QUARANTINE_MINUTES, STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS, STOCK_DEDUCTION_RECOVERY_PASS_BUDGET, STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS_MS, type RecoverDueStockDeductionsDependencies } from "@core/src/features/orders/application/recover-due-stock-deductions";
import { containedDeductionOutcome, containedServeOutcome, deductDueOrderStock, serveWaitingOrders, type DeductDueStockDependencies, type DeductionOutcome, type StockEvent } from "@core/src/features/orders/application/deduct-due-stock";
import { describeOrderStockDue } from "@core/src/features/orders/application/describe-order-stock-due";
import type { StockDue } from "@core/src/features/orders/domain/stock-deduction";
import { listCompaniesWithOverdueStockDeductions, listOverdueOrderIds, listWaitingOrderIds, loadStockOrders, lockOrdersSkipLocked, saveStockDeductions } from "@core/src/features/orders/infrastructure/order-repository";
import { err, map, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, requireActiveTransaction, requireNoActiveTransaction, setLocalTimeouts, withinReadSnapshot, withinSavepoint, withinTransaction, withTenantIsolation, type TransactionOptions } from "@core/src/shared/infrastructure/persistance";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { setOrderDelivery, type SetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { resolveShippingCost as resolveRatedShippingCost } from "@core/src/features/orders/application/resolve-delivery-selection";
import { type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { rejectPendingCatalogOrder } from "@core/src/features/orders/application/reject-pending-catalog-order";
import { buildCheckoutUrl, type CheckoutUrlError } from "@core/src/features/orders/application/checkout-url";
import { readCatalogSettings } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import { createCatalogOrder, type CatalogOrderAccess, type CreateCatalogOrderError, type CreateCatalogOrderInput } from "@core/src/features/orders/application/create-catalog-order";
import { z } from "zod";
import { createOrder, type CreateOrderDependencies } from "@core/src/features/orders/application/create-order";
import { registerPayment, type RegisterPaymentDependencies } from "@core/src/features/orders/application/register-payment";
import { reportPayment, type ReportPaymentDependencies } from "@core/src/features/orders/application/report-payment";
import { rejectPayment, type RejectPaymentDependencies } from "@core/src/features/orders/application/reject-payment";
import { voidPayment, type VoidPaymentDependencies } from "@core/src/features/orders/application/void-payment";
import { registerImmediateSale, type RegisterImmediateSaleDependencies } from "@core/src/features/orders/application/register-immediate-sale";
import { cancelOrder, type CancelOrderDependencies } from "@core/src/features/orders/application/cancel-order";
import { updateOrderShipping, type UpdateOrderShippingDependencies } from "@core/src/features/orders/application/update-order-shipping";
import { registerShipment, registerDelivery, type FulfillOrderDependencies } from "@core/src/features/orders/application/fulfill-order";
import { getOrderAggregate } from "@core/src/features/orders/application/read-order-aggregate";
import { listOrderAggregates } from "@core/src/features/orders/application/list-order-aggregates";
import { listOrders } from "@core/src/features/orders/application/read-orders";
import { deleteExpiredCatalogOrders, type DeleteExpiredCatalogOrdersDependencies, type DeleteExpiredCatalogOrdersInput } from "@core/src/features/orders/application/delete-expired-catalog-orders";
import { allocateOrderNumber, findOrderNumbers, findOpenChatOrderCandidate, findChatOrderTargetForUpdate, saveItemChanges, recordProcessedMessage, savePendingOrder, saveDelivery, savePayment, updatePayment, saveCompletion, saveStockDeduction, saveFulfillment, saveDispatchSchedule, saveCancellation, findOrderAggregate as findAnyOrderAggregate, findOrderAggregates, findOrderAggregatesByIds, findOrderForUpdate as findAnyOrderForUpdate, findOrders, orderExists, readCatalogOrderConfirmation as readConfirmation, listCompaniesWithExpiredCatalogOrders, deleteExpiredCatalogOrders as deleteCompanyExpiredCatalogOrders } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariants, findProductIdsOfVariants, findProductNoticeNames, lockVariantStock, deductStockBulk, findVariantStock, searchSaleCatalog } from "@core/src/features/products";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts";
import { findOrderSourceMessage } from "@core/src/features/chats";
import { applyChatMessage, type ApplyChatMessageDependencies } from "@core/src/features/orders/application/apply-chat-message";
import { createChatToolRegistry } from "@core/src/features/orders/infrastructure/chat-tools";
import { createChatToolActions } from "@core/src/features/orders/application/chat-message-actions";
import { createChatInterpreter } from "@core/src/features/orders/application/chat-message-interpreter";
import { describeChatContext } from "@core/src/features/orders/infrastructure/chat-context-text";
import { createChatMessageDeadLetterHandler, createChatMessageHandler, type ChatMessageHandlerDependencies } from "@core/src/features/orders/application/chat-message-handler";
import { chatMessageDeadlineMs, chatMessagePolicy } from "@core/src/features/orders/application/chat-message-policy";
import type { PublishChatMessageProcessed } from "@core/src/features/orders/application/events";
import { findOutcome, recordFailedOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { claimNotice, releaseNotice } from "@core/src/features/orders/infrastructure/chat-message-notice-repository";
import type { ClaimedNotice } from "@core/src/features/orders/domain/seller-notice";
import { describeChatMessageNotice as describeNotice, type NoticeLocale } from "@core/src/features/orders/application/describe-chat-message-notice";
import { findSellerNoticeTarget } from "@core/src/features/orders/application/find-seller-notice-target";
import { renderSellerNotice } from "@core/src/features/orders/presentation/seller-notice-texts";
import { createAiToolsFromEnv } from "@core/src/shared/ai-tools/composition";
import { isOpenForMessageItems } from "@core/src/features/orders/domain/message-order";
import { products } from "@core/src/features/products/composition";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import { findAvailablePublicImage, readImageBytes, resolvePublicImages } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";
import { orderStateMachine } from "@core/src/features/orders/domain/order-state-machine";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CompanyId, ContactId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";

async function orderTransaction<T, E extends AppError>(callback: () => Promise<Result<T, E>>, deliveryContext?: Readonly<{ orderId: string; userId: string }>, options?: TransactionOptions): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  try {
    return await withinTransaction(callback, options);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_complete_order_transaction", errorCode: "PERSISTENCE_UNAVAILABLE", ...(deliveryContext ? { operation: "set_order_delivery",
      orderId: deliveryContext.orderId, userId: deliveryContext.userId, transactionOutcome: "unknown" } : {}), err: cause }, "unable_to_complete_order_transaction");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to complete order transaction" });
  }
}

const findOrderAggregate = rejectPendingCatalogOrder(findAnyOrderAggregate);
const findOrderForUpdate = rejectPendingCatalogOrder(findAnyOrderForUpdate);
const findSellerCheckoutOrder = rejectPendingCatalogOrder(findCheckoutOrder);

function scopedOrderTransaction<T, E extends AppError>(companyId: string, callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  return orderTransaction(callback);
}
/** Every transaction that publishes a stock event: lock and statement waits end below Prisma's 5000 ms timer, so a contended listener is a contained timeout, never P2028. */
const producerOptions: TransactionOptions = { lockTimeoutMs: 2000, statementTimeoutMs: 3000 };
function producerTransaction<T, E extends AppError>(companyId: string, callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  return orderTransaction(callback, undefined, producerOptions);
}

/** Serving waiting orders: at most this many candidates and this many milliseconds of work inside a restoration (initial values, adjustable). */
export const WAITING_ORDERS_BATCH_SIZE = 100;
export const WAITING_ORDERS_BUDGET_MS = 500;

function emitStockEvent(event: StockEvent) {
  switch (event.kind) {
    case "deducted": return afterTransactionCommit(() => log.info({ event: "order_stock_deducted", companyId: event.companyId, orderId: event.orderId, trigger: event.trigger,
      itemCount: event.itemCount, durationMs: event.durationMs }, "order_stock_deducted"));
    case "waiting": return afterTransactionCommit(() => log.info({ event: "order_stock_waiting", companyId: event.companyId, orderId: event.orderId, trigger: event.trigger,
      shortItemCount: event.shortItemCount }, "order_stock_waiting"));
    case "served": return afterTransactionCommit(() => log.info({ event: "waiting_orders_served", companyId: event.companyId, variantCount: event.variantCount,
      candidates: event.candidates, deducted: event.deducted, skippedLocked: event.skippedLocked, skippedInvalid: event.skippedInvalid,
      budgetExhausted: event.budgetExhausted, durationMs: event.durationMs }, "waiting_orders_served"));
    case "skipped_invalid": return log.error({ event: "stock_deduction_failed", companyId: event.companyId, orderId: event.orderId, trigger: "product_stock_increased",
      stage: "load_order", errorCode: "INVALID_STORED_DATA" }, "stock_deduction_failed");
  }
}

const deductDueStockDependencies: DeductDueStockDependencies = { loadStockOrders, lockOrdersSkipLocked, lockVariantStock, deductStockBulk, saveStockDeductions, listWaitingOrderIds,
  limitStatementsToMs: (ms) => setLocalTimeouts({ statementTimeout: `${ms}ms`, lockTimeout: `${ms}ms` }),
  emit: emitStockEvent, waitingOrdersBatchSize: WAITING_ORDERS_BATCH_SIZE, waitingOrdersBudgetMs: WAITING_ORDERS_BUDGET_MS, clock: () => new Date() };

// The registry lives here because every handler belongs to orders; products receives the publisher by injection.
const stockRegistry: InTransactionRegistry<TransactionEndingError> = {
  payment_confirmed: deductDueOrderStock("payment_confirmed", deductDueStockDependencies),
  order_delivery_changed: deductDueOrderStock("order_delivery_changed", deductDueStockDependencies),
  order_stock_deduction_overdue: deductDueOrderStock("order_stock_deduction_overdue", deductDueStockDependencies),
  product_stock_increased: serveWaitingOrders(deductDueStockDependencies),
};

export const publishStockEvent = createInTransactionPublisher(stockRegistry, {
  requireTransaction: requireActiveTransaction,
  withinSavepoint,
  containedOutcome: ((name: string, payload: { companyId: string; orderId?: string }, failure: Parameters<typeof containedDeductionOutcome>[0]) => {
    const contended = ["LOCK_TIMEOUT", "STATEMENT_TIMEOUT", "DEADLOCK"].includes(failure.errorCode);
    // Recovery reports an order once, when it enters quarantine, so it does not log here.
    if (name !== "order_stock_deduction_overdue" && !(name === "product_stock_increased" && contended && failure.errorCode !== "DEADLOCK")) {
      const fields = { companyId: payload.companyId, orderId: payload.orderId, trigger: name, stage: failure.stage, errorCode: failure.errorCode };
      if (contended) log.warn({ event: "stock_deduction_contended", ...fields }, "stock_deduction_contended");
      else log.error({ event: "stock_deduction_failed", ...fields, err: failure.cause }, "stock_deduction_failed");
    }
    return name === "product_stock_increased" ? containedServeOutcome(failure) : containedDeductionOutcome(failure);
  }) as never,
  onTransactionEnding: (name, error) => log.warn({ event: "stock_deduction_rolled_back", event_name: name, errorCode: error.code }, "stock_deduction_rolled_back"),
});

// --- Recovery of due orders that stayed undeducted (worker only) ---
const recoveryTransaction: TransactionOptions = { timeout: 3000, lockTimeoutMs: 1000, statementTimeoutMs: 1000 };
const quarantinedUntil = new Map<OrderId, number>();
const quarantineMs = STOCK_DEDUCTION_FAILURE_QUARANTINE_MINUTES * 60_000;
const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });
const waitFor = (ms: number, signal: AbortSignal) => new Promise<"elapsed" | "aborted">((resolve) => {
  if (signal.aborted) return resolve("aborted");
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
  const onAbort = () => { done(); resolve("aborted"); };
  const timer = setTimeout(() => { done(); resolve("elapsed"); }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
});
let recoveryPassSequence = 0;

const recoveryDependencies: RecoverDueStockDeductionsDependencies = {
  listCompaniesWithOverdueStockDeductions,
  listOverdueOrderIds: (companyId, limit, exclude) => withTenantIsolation(companyId, () => orderTransaction(() => listOverdueOrderIds(companyId, limit, exclude), undefined, recoveryTransaction)),
  // The order is locked first and skipped when a seller operation holds it, so recovery never waits while holding anything.
  publishOverdueInOwnTransaction: (companyId, orderId) => withTenantIsolation(companyId, () => orderTransaction(async () => {
    const locked = await lockOrdersSkipLocked([orderId], companyId);
    if (!locked.success) return unavailable(locked.error.message);
    if (locked.data.length === 0) return ok<DeductionOutcome>({ kind: "skipped_locked" });
    const published = await publishStockEvent("order_stock_deduction_overdue", { companyId, orderId });
    return published.success ? published : unavailable(published.error.message);
  }, undefined, recoveryTransaction)),
  quarantine: {
    list: (now) => { for (const [id, until] of quarantinedUntil) if (until <= now.getTime()) quarantinedUntil.delete(id); return [...quarantinedUntil.keys()]; },
    add: (id, now) => { const fresh = (quarantinedUntil.get(id) ?? 0) <= now.getTime(); quarantinedUntil.set(id, now.getTime() + quarantineMs); return fresh; },
  },
  wait: waitFor,
  passSequence: () => recoveryPassSequence++,
  log: (level, event, fields) => log[level]({ event, ...fields }, event),
  passOffsetsMs: STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS_MS, lastPassStartMs: STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS,
  passBudget: STOCK_DEDUCTION_RECOVERY_PASS_BUDGET, clock: () => new Date(),
};

/** The scheduled job: one run per minute, up to three passes. A failed company listing fails the run; the next minute is its retry. */
export const recoverStockDeductionsJob: ScheduledJobHandler = async ({ signal }) => {
  const result = await recoverDueStockDeductions(signal, recoveryDependencies);
  return result.success ? ok(undefined) : err({ ...result.error, retryable: false });
};

/** Stock rows of these variants, read without lock; the quantities are validated by whoever uses them. */
const readStock = findVariantStock;

/** `stockDue` of orders returned after commit (void, reject, ship, deliver, cancel, aggregate reads): one stock read for all the due ones, none when nothing is due. */
async function describeStockDue(found: readonly OrderAggregate[]): Promise<Result<ReadonlyMap<OrderId, StockDue | null>, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  try {
    const described = await describeOrderStockDue(found, { readStock, inSnapshot: withinReadSnapshot });
    return described.success ? described : err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: described.error.message });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_describe_stock_due", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_describe_stock_due");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read stock" });
  }
}

/** One batched lookup per order; an unreadable stored variant is a persistence failure for the sale. */
const findSellableOrderVariants: CreateOrderDependencies["findVariants"] = async (ids) => {
  const found = await findSellableVariants(ids);
  return found.success ? found : err({ code: "PERSISTENCE_UNAVAILABLE", message: found.error.message });
};
const pendingTransaction: CreateOrderDependencies["transaction"] = scopedOrderTransaction;
const paymentTransaction: RegisterPaymentDependencies["transaction"] = producerTransaction;
const reportTransaction: ReportPaymentDependencies["transaction"] = scopedOrderTransaction;
const voidTransaction: VoidPaymentDependencies["transaction"] = scopedOrderTransaction;
const rejectTransaction: RejectPaymentDependencies["transaction"] = scopedOrderTransaction;
const immediateTransaction: RegisterImmediateSaleDependencies["transaction"] = producerTransaction;
const cancellationTransaction: CancelOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentTransaction: FulfillOrderDependencies["transaction"] = scopedOrderTransaction;
// Shipping deducts pending stock, so the deduction logs under its own operation like set_order_delivery does.
const fulfillmentDependencies: FulfillOrderDependencies = { transaction: fulfillmentTransaction, findOrderForUpdate,
  saveFulfillment, clock: () => new Date(),
  lockVariantStock, deductStockBulk,
  saveStockDeduction: (id, companyId) => saveStockDeduction(id, companyId, "ship_order") };

export async function setConfiguredOrderDelivery(input: SetDeliveryInput, context: OrderAccess) {
  const started = performance.now();
  const observed: { previous: OrderAggregate | null; settingsVersion?: number; courierId?: string; optionId?: string; agencyId?: string; stage: string } = { previous: null, stage: "lock_order" };
  const result = await setOrderDelivery(input, context, {
    transaction: (companyId, work) => {
      if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
      return orderTransaction(work, { orderId: input.orderId, userId: context.userId }, producerOptions);
    },
    findOrderForUpdate: async (id, companyId) => {
      const found = await findOrderForUpdate(id, companyId, "set_order_delivery");
      if (found.success) observed.previous = found.data;
      return found;
    },
    resolveRatedDelivery: async (selection, access, currency, expectedPrice) => {
      observed.stage = "resolve_delivery";
      if (selection.method === "agency") observed.agencyId = selection.agencyId; // kept for the rejection log (RATE_UNAVAILABLE never reaches the snapshot)
      const resolved = await resolveRatedShippingCost(selection, { companyId: access.companyId, author: { kind: "seller", userId: access.userId } }, currency, expectedPrice, {
        getStoreSettings: () => deliverySettings.get(access, "set_order_delivery"),
        resolveSelectedDeliveryRate: deliverySettings.resolveSelectedDeliveryRate,
      });
      if (resolved.success) {
        const { delivery } = resolved.data;
        observed.settingsVersion = delivery.method === "store" ? delivery.settingsVersion : delivery.pricing.settingsVersion;
        if (delivery.method !== "store") observed.optionId = delivery.pricing.optionId;
        if (delivery.method === "agency") { observed.courierId = delivery.courier.id; observed.agencyId = delivery.agency.id; }
      }
      return resolved;
    },
    saveDelivery: (id, companyId, change) => { observed.stage = "save_delivery"; return saveDelivery(id, companyId, change); },
    publishStockEvent: (payload) => { observed.stage = "deduct_stock"; return publishStockEvent("order_delivery_changed", payload); },
    findVariantStock,
  });
  const durationMs = Math.round(performance.now() - started);
  if (result.success) {
    const before = observed.previous;
    afterTransactionCommit(() => log.info({ event: "order_delivery_saved", operation: "set_order_delivery", orderId: input.orderId,
      userId: context.userId, authorKind: "seller", changeKind: before?.delivery ? "replaced" : "assigned",
      courierId: observed.courierId, optionId: observed.optionId, agencyId: observed.agencyId, previousDeliveryMethod: before?.delivery?.method, deliveryMethod: input.delivery.method, settingsVersion: observed.settingsVersion,
      totalChanged: before?.total.amount !== result.data.order.total.amount,
      stockDeductionRequired: !before?.stockDeducted && result.data.order.stockDeducted, stockDeducted: result.data.order.stockDeducted,
      transactionOutcome: "committed", durationMs }, "Order delivery saved"));
  } else if (!["ORDER_NOT_FOUND", "PERSISTENCE_UNAVAILABLE", "INVALID_STORED_DATA", "INVALID_ORDER", "CURRENCY_MISMATCH"].includes(result.error.code)) {
    log.debug({ event: "order_delivery_rejected", operation: "set_order_delivery", orderId: input.orderId, userId: context.userId,
      courierId: observed.courierId, optionId: observed.optionId, agencyId: observed.agencyId, deliveryMethod: input.delivery.method, settingsVersion: observed.settingsVersion, deliveryStatus: observed.previous?.deliveryStatus, cancelled: observed.previous?.cancelled,
      errorCode: result.error.code, stage: observed.stage,
      ...(result.error.code === "DELIVERY_UNAVAILABLE" ? { reason: result.error.reason } : {}) }, "Order delivery rejected");
  }
  return result;
}

export function createConfiguredOrder(input: CreateCompleteOrderInput, context: OrderAccess) {
  return createCompleteOrder(input, context, {
    transaction: producerTransaction,
    create: orders.create,
    setDelivery: (delivery, access) => setConfiguredOrderDelivery(delivery, access),
    registerPayment: (payment, access) => registerPayment(payment, access, { transaction: paymentTransaction,
      findOrderForUpdate, savePayment, updatePayment, saveCompletion, publishPaymentConfirmed: (payload) => publishStockEvent("payment_confirmed", payload), findVariantStock, clock: () => new Date() }),
    ship: orders.ship,
    deliver: orders.deliver,
  });
}

const checkoutDependencies: CheckoutDependencies = { transaction: scopedOrderTransaction,
  findOrder: findCheckoutOrder, findOrderForUpdate: findAnyCheckoutOrderForUpdate,
  saveBuyer: saveCheckoutBuyer, saveConfirmed: saveCheckoutConfirmed,
};
/** Photos are decorative: the failure is logged here, where it is known, and the use case falls back to markers. */
async function findItemPhotos(variantIds: readonly VariantId[]): Promise<Result<ReadonlyMap<VariantId, string>, CheckoutPhotoError>> {
  const photos = await products.findVariantPhotos(variantIds);
  if (photos.success) return photos;
  log.error({ event: "order_checkout_photos_unavailable", companyId: getCompanyId(), errorCode: photos.error.code, variantCount: variantIds.length }, "order_checkout_photos_unavailable");
  return err({ code: "PHOTOS_UNAVAILABLE" as const, message: "Unable to read product photos" });
}
const getCheckoutDependencies: GetOrderCheckoutDependencies = { findOrder: findCheckoutOrder, findItemPhotos };
/** For callers that only need the checkout state: no photo lookup, so nothing is queried or logged about photos. */
const getCheckoutViewDependencies: GetOrderCheckoutDependencies = { findOrder: findCheckoutOrder, findItemPhotos: async () => ok(new Map()) };
async function readCheckout(access: CheckoutAccess, deps: GetOrderCheckoutDependencies) {
  bindRequestOperation({ operation: "get_checkout" });
  const result = await withTenantIsolation(access.companyId, () => getOrderCheckout(access, deps));
  if (!result.success) rejectedCheckout(result.error);
  else bindRequestOperation({ outcome: result.data.checkout.state.kind, orderNumber: result.data.checkout.number });
  return result;
}
function rejectedCheckout(error: CheckoutError) {
  const outcomes = { CHECKOUT_UNAVAILABLE: "unavailable", ORDER_CANCELLED: "cancelled", INVALID_BUYER: "invalid_input",
    TOTAL_CHANGED: "total_changed", INVALID_CHECKOUT: "technical_failure", PERSISTENCE_UNAVAILABLE: "technical_failure",
    DELIVERY_METHOD_DISABLED: "invalid_input", DELIVERY_LOCKED: "invalid_input", INVALID_DELIVERY: "invalid_input" } as const;
  bindRequestOperation({ outcome: outcomes[error.code] });
}

/** The buyer's company is the brand host's: the order is read by id under that tenant, so another company's order is simply not found. */
export async function resolveBuyerAccess(id: string, hostCompanyId: CompanyId) {
  if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_ORDER" as const, message: "Invalid order ID" });
  const found = await withTenantIsolation(hostCompanyId, () => orderExists(id));
  return found.success ? found.data ? { success: true as const, data: { kind: "buyer" as const, companyId: hostCompanyId, orderId: id as OrderId } }
    : err({ code: "ORDER_NOT_FOUND" as const, message: "Order not found" }) : found;
}

function receiptImageId(payment: OrderAggregate["payments"][number]) {
  if (payment.status === "reported") return payment.data.receiptImageId;
  if (payment.status === "rejected") return payment.data.report.receiptImageId;
  return payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
}

function rejectedReport(order: OrderAggregate): BuyerPaymentView["rejectedReport"] {
  const rejected = orderStateMachine.rejectionAwaitingNewReport(order);
  return rejected ? { reason: rejected.data.reason } : null;
}

export async function getBuyerPaymentView(id: string, hostCompanyId: CompanyId) {
  if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_ORDER" as const, message: "Invalid order ID" });
  const access = { data: { companyId: hostCompanyId, orderId: id as OrderId } };
  return withTenantIsolation(access.data.companyId, async () => {
    const [found, settings] = await Promise.all([
      // A pending catalog order is not found here either: payment starts only after the buyer confirms.
      findOrderAggregate(access.data.orderId, access.data.companyId), companyPaymentSettings.get(access.data.companyId),
    ]);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND" as const, message: "Order not found" });
    const allowed = canAccessBuyerPayment(found.data);
    if (!allowed.success) return allowed;
    if (!settings.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Payment settings unavailable" });
    const summary = orderStateMachine.getPaymentSummary(found.data);
    if (!summary.success) return summary;
    const settingImageIds = settings.data.map((item) => item.imageId);
    const imageIds = [...settingImageIds, ...found.data.payments.map(receiptImageId)].filter((value): value is NonNullable<typeof value> => value !== null);
    const resolved = await resolvePublicImages(imageIds);
    if (!resolved.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Image unavailable" });
    const images = new Map(resolved.data.images.map((image) => [image.id, image.url]));
    const availability = "available" as const;
    // A wallet whose QR url does not resolve is not listed: a missing image never fails the whole view.
    const offered: BuyerPaymentView["settings"] = settings.data.flatMap((item): BuyerPaymentView["settings"] => {
      if (item.method === "bank_transfer") return [{ method: item.method, bank: item.bank, holder: item.holder, accountNumber: item.accountNumber, cci: item.cci,
        imageUrl: item.imageId ? images.get(item.imageId) ?? null : null }];
      const imageUrl = images.get(item.imageId);
      return imageUrl ? [{ method: item.method, provider: item.provider, holder: item.holder, imageUrl }] : [];
    });
    const view: BuyerPaymentView = { orderId: found.data.id, total: found.data.total, deliveryCharge: found.data.deliveryCharge, availability,
      paidAmount: summary.data.paidAmount, balanceDue: summary.data.balanceDue, paymentStatus: summary.data.status,
      settings: offered,
      payments: found.data.payments.map((payment) => { const imageId = receiptImageId(payment);
        return { id: payment.id, status: payment.status, amount: payment.amount, method: payment.method,
          receiptImageUrl: imageId ? images.get(imageId) ?? null : null, rejectionReason: payment.status === "rejected" ? payment.data.reason : null }; }),
      rejectedReport: rejectedReport(found.data) };
    return { success: true as const, data: view };
  });
}

export const deleteCompanyCatalogOrderBatch: DeleteExpiredCatalogOrdersDependencies["deleteExpiredCatalogOrders"] = (companyId, cutoff, limit) =>
  withTenantIsolation(companyId, () => scopedOrderTransaction(companyId, () => deleteCompanyExpiredCatalogOrders(companyId, cutoff, limit)));

/** Worker sweep: each company's batch runs in its own transaction under RLS; an unexpected error fails only that company. */
export function deleteConfiguredExpiredCatalogOrders(input: DeleteExpiredCatalogOrdersInput, deleteBatch = deleteCompanyCatalogOrderBatch) {
  return deleteExpiredCatalogOrders(input, { listCompaniesWithExpiredCatalogOrders,
    deleteExpiredCatalogOrders: async (companyId, cutoff, limit) => {
      try {
        return await deleteBatch(companyId, cutoff, limit);
      } catch (cause) {
        log.error({ event: "unable_to_delete_catalog_orders", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to delete catalog orders");
        return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to delete catalog orders" });
      }
    } });
}

/** The checkout link on the brand host of `subdomain`, which the caller already holds; no query. */
const checkoutUrlFor = (subdomain: CatalogSubdomain | null, orderId: OrderId) =>
  buildCheckoutUrl(storefrontConfig.baseUrl, subdomain, orderId);

/** The same link for the company's current subdomain, read here for callers that do not have it at hand. */
async function checkoutUrl(companyId: CompanyId, orderId: OrderId): Promise<Result<string, CheckoutUrlError | { code: "PERSISTENCE_UNAVAILABLE"; message: string }>> {
  const stored = await withTenantIsolation(companyId, () => readCatalogSettings(companyId));
  if (!stored.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: stored.error.message });
  return checkoutUrlFor(stored.data?.subdomain ?? null, orderId);
}

async function createConfiguredCatalogOrder(input: CreateCatalogOrderInput, access: CatalogOrderAccess): Promise<Result<OrderAggregate, CreateCatalogOrderError>> {
  requireNoActiveTransaction();
  let inserted = false;
  const result = await withTenantIsolation(access.companyId, () => createCatalogOrder(input, access, {
    transaction: scopedOrderTransaction,
    findOrder: async (id) => {
      const found = await findAnyOrderAggregate(id, access.companyId, "create_catalog_order");
      if (found.success) return found;
      return err({ code: found.error.code === "PERSISTENCE_UNAVAILABLE" ? found.error.code : "INVALID_STORED_DATA" as const, message: found.error.message });
    },
    findSellableVariants,
    allocateNumber: allocateOrderNumber,
    saveCatalogOrder: async (order) => {
      const saved = await savePendingOrder(order);
      if (saved.success) { inserted = true; return saved; }
      if (saved.error.code === "ORDER_ALREADY_EXISTS") return err({ code: "ORDER_ID_CONFLICT" as const, message: saved.error.message });
      // Deleted after the sellable read: the buyer fixes the line like any other unavailable one.
      if (saved.error.code === "VARIANT_NOT_FOUND") return err({ code: "LINES_UNAVAILABLE" as const, message: "Some cart lines are not available",
        issues: [{ variantId: saved.error.variantId as VariantId, reason: "unavailable" as const }] });
      log.error({ event: "unable_to_save_catalog_order", companyId: access.companyId, errorCode: saved.error.code }, "unable_to_save_catalog_order");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: saved.error.message });
    },
    newItemId: () => randomUUID() as OrderItemId,
    clock: () => new Date(),
  }));
  if (result.success && inserted) log.info({ event: "catalog_order_created", companyId: access.companyId, orderNumber: result.data.number,
    linesCount: result.data.items.length }, "Catalog order created");
  return result;
}

export const orders = {
  // Notice capabilities for notifications. They run inside the company's tenant context.
  claimChatMessageNotice: (messageId: ChatMessageId) => claimNotice(messageId),
  describeChatMessageNotice: (claim: ClaimedNotice, locale: NoticeLocale) => describeNotice(claim, locale, {
    companyId: getCompanyId, findOrderNumbers, findProductNames: findProductNoticeNames, render: renderSellerNotice }),
  releaseChatMessageNotice: (messageId: ChatMessageId) => releaseNotice(messageId),
  findSellerNoticeTarget: (messageId: ChatMessageId) => findSellerNoticeTarget(messageId, { findOutcome, orderExists }),
  confirmCheckoutDelivery: async (input: ConfirmCheckoutDeliveryInput, access: CheckoutAccess) => {
    requireNoActiveTransaction();
    bindRequestOperation({ operation: "confirm_checkout" });
    const result = await withTenantIsolation(access.companyId, () => confirmCheckoutDelivery(input, access, new Date(), {
      transaction: producerTransaction, findOrderForUpdate: findAnyCheckoutOrderForUpdate,
      saveBuyer: saveCheckoutBuyer, saveConfirmed: saveCheckoutConfirmed,
      saveDelivery, publishStockEvent: (payload) => publishStockEvent("order_delivery_changed", payload), findVariantStock,
      getStoreSettings: deliverySettings.getForCompany, resolveSelectedDeliveryRate: deliverySettings.resolveSelectedDeliveryRate,
    }));
    if (!result.success) {
      bindRequestOperation({ outcome: result.error.code === "TOTAL_CHANGED" ? "total_changed" :
        ["PERSISTENCE_UNAVAILABLE", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "INVALID_STORED_DATA"].includes(result.error.code) ? "technical_failure" : "invalid_input" });
      return result;
    }
    bindRequestOperation({ outcome: result.data.changed ? "confirmed" : "already_confirmed", orderNumber: result.data.checkout.number });
    if (result.data.changed) log.info({ event: "order_checkout_confirmed", companyId: access.companyId,
      orderNumber: result.data.checkout.number, fromCatalog: result.data.fromCatalog }, "Order checkout confirmed");
    return ok(result.data.checkout);
  },
  setDelivery: (input: SetDeliveryInput, context: OrderAccess) => setConfiguredOrderDelivery(input, context),
  createCatalogOrder: createConfiguredCatalogOrder,
  /** Whether a catalog order was confirmed in the checkout; a missing, pending or other company's order is `not_confirmed`. */
  readCatalogOrderConfirmation: (companyId: CompanyId, orderId: OrderId) => withTenantIsolation(companyId, () => readConfirmation(companyId, orderId)),
  checkoutUrl,
  checkoutUrlFor,
  resolveBuyerAccess,
  getBuyerPaymentView,
  enableCheckout: async (orderId: OrderId, access: OrderAccess) => {
    requireNoActiveTransaction();
    bindRequestOperation({ operation: "enable_checkout" });
    const result = await withTenantIsolation(access.companyId, () => enableOrderCheckout(orderId, access, { findOrder: findSellerCheckoutOrder }));
    if (!result.success) { rejectedCheckout(result.error); return result; }
    const link = await checkoutUrl(access.companyId, orderId);
    bindRequestOperation({ outcome: link.success ? "loaded" : link.error.code === "SUBDOMAIN_REQUIRED" ? "unavailable" : "technical_failure", orderNumber: result.data.number });
    return map(link, (url) => ({ url }));
  },
  getCheckout: (access: CheckoutAccess) => readCheckout(access, getCheckoutDependencies),
  getCheckoutView: async (access: CheckoutAccess) => map(await readCheckout(access, getCheckoutViewDependencies), ({ checkout }) => checkout),
  confirmCheckout: async (input: ConfirmOrderCheckoutInput, access: CheckoutAccess) => {
    requireNoActiveTransaction();
    bindRequestOperation({ operation: "confirm_checkout" });
    const result = await withTenantIsolation(access.companyId, () => confirmOrderCheckout(input, access, new Date(), checkoutDependencies));
    if (!result.success) { rejectedCheckout(result.error); return result; }
    bindRequestOperation({ outcome: result.data.changed ? "confirmed" : "already_confirmed", orderNumber: result.data.checkout.number });
    if (result.data.changed) log.info({ event: "order_checkout_confirmed", companyId: access.companyId, orderNumber: result.data.checkout.number, fromCatalog: result.data.fromCatalog }, "Order checkout confirmed");
    return ok(result.data.checkout);
  },
  listAggregates: (criteria: Parameters<typeof listOrderAggregates>[0], context: Parameters<typeof listOrderAggregates>[1]) =>
    listOrderAggregates(criteria, context, findOrderAggregates),
  /** Read-only: the company's orders among these ids with their derived state, one query. */
  getAggregatesByIds: (ids: readonly OrderId[], companyId: CompanyId) => findOrderAggregatesByIds(ids, companyId),
  getAggregate: (id: Parameters<typeof getOrderAggregate>[0], context: Parameters<typeof getOrderAggregate>[1]) =>
    getOrderAggregate(id, context, findOrderAggregate),
  ship: (id: Parameters<typeof registerShipment>[0], context: Parameters<typeof registerShipment>[1]) =>
    registerShipment(id, context, fulfillmentDependencies),
  updateShipping: (input: Parameters<typeof updateOrderShipping>[0], context: Parameters<typeof updateOrderShipping>[1]) =>
    updateOrderShipping(input, context, { ...fulfillmentDependencies, saveDispatchSchedule } satisfies UpdateOrderShippingDependencies),
  deliver: (id: Parameters<typeof registerDelivery>[0], context: Parameters<typeof registerDelivery>[1]) =>
    registerDelivery(id, context, fulfillmentDependencies),
  cancel: async (id: Parameters<typeof cancelOrder>[0], context: Parameters<typeof cancelOrder>[1]) => {
    requireNoActiveTransaction();
    let failure: EventBusError | undefined;
    const publishOrderCancelled: CancelOrderDependencies["publishOrderCancelled"] = async (payload) => {
      const published = await applicationEventBus().publishEvent("order_cancelled", payload);
      if (!published.success) failure = published.error;
      return published;
    };
    const result = await cancelOrder(id, context, { transaction: cancellationTransaction, findOrderForUpdate, saveCancellation, publishOrderCancelled });
    if (failure && result.success) log.error({ event: "order_cancelled_publish_failed", companyId: context.companyId, orderId: id, orderNumber: result.data.number, errorCode: failure.code, err: failure }, "order_cancelled_publish_failed");
    return result;
  },
  registerImmediateSale: (input: Parameters<typeof registerImmediateSale>[0], context: Parameters<typeof registerImmediateSale>[1]) =>
    registerImmediateSale(input, context, { transaction: immediateTransaction, orderExists,
      findVariants: findSellableOrderVariants, saveOrder: savePendingOrder, allocateNumber: allocateOrderNumber,
      savePayment, publishPaymentConfirmed: (payload) => publishStockEvent("payment_confirmed", payload), saveFulfillment,
      newItemId: () => randomUUID() as OrderItemId, newPaymentId: () => randomUUID() as PaymentId, clock: () => new Date() }),
  registerPayment: async (input: Parameters<typeof registerPayment>[0], context: Parameters<typeof registerPayment>[1]) => {
    let applied = false;
    const markSaved: typeof savePayment = async (...args) => { const result = await savePayment(...args); if (result.success) applied = true; return result; };
    const markUpdated: typeof updatePayment = async (...args) => { const result = await updatePayment(...args); if (result.success) applied = true; return result; };
    const result = await registerPayment(input, context, { transaction: paymentTransaction, findOrderForUpdate,
      savePayment: markSaved, updatePayment: markUpdated, saveCompletion,
      publishPaymentConfirmed: (payload) => publishStockEvent("payment_confirmed", payload), findVariantStock, clock: () => new Date() });
    if (result.success) {
      const { order, stockDue } = result.data;
      const stockStatus = order.stockDeducted ? "deducted" : stockDue?.kind ?? "not_due";
      if (applied) log.info({ event: "payment_confirmed", paymentId: input.paymentId, actorKind: "seller", userId: context.userId,
        source: input.source ?? "manual", stockStatus, transactionOutcome: "committed" }, "payment_confirmed");
      else log.debug({ event: "payment_operation_replayed", operation: "confirm", paymentId: input.paymentId }, "payment_operation_replayed");
    } else if (result.error.code === "PAYMENT_CONFLICT") log.debug({ event: "payment_operation_conflict", operation: "confirm",
      paymentId: input.paymentId, errorCode: result.error.code }, "payment_operation_conflict");
    return result;
  },
  reportPayment: async (input: Parameters<typeof reportPayment>[0], access: Parameters<typeof reportPayment>[1]) => {
    let applied = false;
    const markSaved: typeof savePayment = async (...args) => { const result = await savePayment(...args); if (result.success) applied = true; return result; };
    const result = await reportPayment(input, access, { transaction: reportTransaction, findOrderForUpdate, findReceipt: findAvailablePublicImage,
      savePayment: markSaved, clock: () => new Date() });
    if (result.success) {
      if (applied) log.info({ event: "payment_reported", paymentId: input.paymentId, imageId: input.receiptImageId,
        actorKind: "buyer", outcome: "applied" }, "payment_reported");
      else log.debug({ event: "payment_operation_replayed", operation: "report", paymentId: input.paymentId }, "payment_operation_replayed");
    } else if (result.error.code === "PAYMENT_CONFLICT") log.debug({ event: "payment_operation_conflict", operation: "report",
      paymentId: input.paymentId, errorCode: result.error.code }, "payment_operation_conflict");
    return result;
  },
  voidPayment: async (input: Parameters<typeof voidPayment>[0], context: Parameters<typeof voidPayment>[1]) => {
    let applied = false;
    const markUpdated: typeof updatePayment = async (...args) => { const result = await updatePayment(...args); if (result.success) applied = true; return result; };
    const result = await voidPayment(input, context, { transaction: voidTransaction, findOrderForUpdate,
      updatePayment: markUpdated, saveCompletion, clock: () => new Date() });
    if (result.success) {
      if (applied) log.info({ event: "payment_voided", paymentId: input.paymentId, actorKind: "seller", userId: context.userId,
        outcome: "applied", transactionOutcome: "committed" }, "payment_voided");
      else log.debug({ event: "payment_operation_replayed", operation: "void", paymentId: input.paymentId }, "payment_operation_replayed");
    }
    return result;
  },
  rejectPayment: async (input: Parameters<typeof rejectPayment>[0], context: Parameters<typeof rejectPayment>[1]) => {
    const result = await rejectPayment(input, context, { transaction: rejectTransaction, findOrderForUpdate, updatePayment, clock: () => new Date() });
    if (result.success) {
      if (result.data.applied) log.info({ event: "payment_rejected", companyId: context.companyId, userId: context.userId, orderId: input.orderId,
        paymentId: input.paymentId, hasReason: input.reason !== null && input.reason.trim() !== "" }, "payment_rejected");
      else log.debug({ event: "payment_operation_replayed", operation: "reject", paymentId: input.paymentId }, "payment_operation_replayed");
    } else if (result.error.code === "PAYMENT_CONFLICT") log.debug({ event: "payment_operation_conflict", operation: "reject",
      paymentId: input.paymentId, errorCode: result.error.code }, "payment_operation_conflict");
    return result;
  },
  describeStockDue,
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: pendingTransaction, orderExists,
      findVariants: findSellableOrderVariants, saveOrder: savePendingOrder, allocateNumber: allocateOrderNumber,
      newItemId: () => randomUUID() as OrderItemId, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  searchProducts: searchSaleCatalog,
};

// Chats and contacts return plain strings; the brands belong to orders and are applied only here.
const persistenceUnavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });

/** The open order as the models see it. Read without lock: the transaction re-reads the order under lock. */
async function findChatOrderContext(chatId: ChatId) {
  const candidate = await findOpenChatOrderCandidate(chatId);
  if (!candidate.success) return candidate;
  if (!candidate.data) return ok({ items: [] });
  const found = await findAnyOrderAggregate(candidate.data, getCompanyId() as CompanyId, "apply_chat_message");
  if (!found.success && found.error.code === "PERSISTENCE_UNAVAILABLE") return persistenceUnavailable(found.error.message);
  // An invalid stored order shows no items; the locked read fails the message for good.
  if (!found.success || !found.data || !isOpenForMessageItems(found.data, chatId)) return ok({ items: [] });
  const productIds = await findProductIdsOfVariants(found.data.items.map((item) => item.variantId));
  if (!productIds.success) return persistenceUnavailable(productIds.error.message);
  return ok({ items: found.data.items.map((item, index) => ({ label: `I${index + 1}`, variantId: item.variantId, productId: productIds.data.get(item.variantId) ?? null,
    productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity, unitPrice: item.unitPrice })) });
}

const aiTools = createAiToolsFromEnv(process.env);
// The products composition imports the event handlers that import this module, so `products` is only read when a message is applied.
const chatToolRegistry = createChatToolRegistry(createChatToolActions({
  loadSellableVariants: (productIds) => products.loadSellableVariants(productIds),
  resolveVariant: (input, signal) => products.resolveVariant(input, signal),
  identifyProductsInText: (lines, signal) => products.identifyProductsInText(lines, signal),
  findTopTextCandidate: (mention) => products.findTopTextCandidate(mention),
}));

const chatMessageDependencies: ApplyChatMessageDependencies = {
  findOutcome,
  findSourceMessage: async (id) => {
    const found = await findOrderSourceMessage(id);
    if (!found.success || !found.data) return found as Result<null, Persistence>;
    const message = found.data;
    return ok({ ...message, companyId: message.companyId as string as CompanyId, chatId: message.chatId as ChatId,
      contactId: message.contactId as ContactId, uploadedByUserId: message.uploadedByUserId as string as UserId, imageId: message.imageId as ImageId | null });
  },
  findChatOrderContext,
  readImage: (imageId) => readImageBytes(imageId),
  identifyProductsInImage: (image) => products.identifyProductsInImage(image),
  loadSellableProducts: (productIds) => products.loadSellableVariants(productIds),
  catalogSearchReadiness: () => products.catalogSearchReadiness(),
  interpretationEnabled: aiTools !== null,
  interpretAndApply: createChatInterpreter(chatToolRegistry, aiTools, describeChatContext),
  transaction: scopedOrderTransaction,
  lockContact,
  ensureCustomerForContact: async (contactId) => {
    const ensured = await ensureCustomerForContact(contactId);
    return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured;
  },
  findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
  allocateNumber: () => allocateOrderNumber(getCompanyId() as CompanyId),
  saveNewOrder: (order, link) => savePendingOrder(order, link),
  saveItemChanges,
  recordOrderMessage: recordProcessedMessage,
  recordOutcome,
  newOrderId: () => randomUUID() as OrderId,
  newItemId: () => randomUUID() as OrderItemId,
  clock: () => new Date(),
  limits: { maxItemQuantity: 99 as PositiveInteger },
};

type Persistence = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** The notice is published after the commit; a failure never raises: the order change stands and the notice is lost. */
const publishChatMessageProcessed: PublishChatMessageProcessed = async (payload) => {
  try {
    return await applicationEventBus().provider.publish("chat_message_processed", payload, { eventId: payload.messageId, occurredAt: new Date().toISOString() });
  } catch (cause) {
    log.error({ event: "chat_message_processed_publish_failed", companyId: payload.companyId, messageId: payload.messageId, err: cause }, "chat_message_processed_publish_failed");
    return err({ code: "EVENT_BUS_UNAVAILABLE" as const, message: "Event publication failed" });
  }
};

const chatMessageHandlerDependencies: ChatMessageHandlerDependencies = {
  withTenant: withTenantIsolation,
  apply: (input, signal) => applyChatMessage(input, chatMessageDependencies, signal),
  recordFailedOutcome,
  publishNotice: publishChatMessageProcessed,
  deadlineMs: chatMessageDeadlineMs,
  retries: chatMessagePolicy.retries,
};

/** Handler of `message_created`. */
export const applyChatMessageHandler = createChatMessageHandler(chatMessageHandlerDependencies);
/** Handler of the dead-letter queue of `apply-chat-message`: releases the chat of a message that cannot be applied. */
export const chatMessageDeadLetterHandler = createChatMessageDeadLetterHandler(chatMessageHandlerDependencies);
