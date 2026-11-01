import { applicationEventBus } from "@core/src/composition/event-bus";
import type { EventBusError, ScheduledJobHandler } from "@core/src/shared/events/application/contracts";
import { createCompleteOrder, type CreateCompleteOrderInput } from "@core/src/features/orders/application/create-complete-order";
import { enableOrderCheckout, getOrderCheckout, confirmOrderCheckout, confirmCheckoutDelivery, type CheckoutDependencies, type CheckoutPhotoError, type GetOrderCheckoutDependencies, type ConfirmOrderCheckoutInput, type ConfirmCheckoutDeliveryInput } from "@core/src/features/orders/application/checkout";
import { findCheckoutOrder, findCheckoutOrderForUpdate as findAnyCheckoutOrderForUpdate, saveCheckoutBuyer, saveCheckoutConfirmed } from "@core/src/features/orders/infrastructure/checkout-repository";
import { canAccessBuyerPayment, type CheckoutAccess, type CheckoutError } from "@core/src/features/orders/domain/checkout";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { classifyPersistenceFailure, isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ContainedFailure, TransactionEndingError } from "@core/src/shared/application/contained-failure";
import { createInTransactionPublisher, type InTransactionRegistry } from "@core/src/shared/events/application/in-transaction-events";
import { recoverDueStockDeductions, STOCK_DEDUCTION_FAILURE_QUARANTINE_MINUTES, STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS, STOCK_DEDUCTION_RECOVERY_PASS_BUDGET, STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS_MS, type RecoverDueStockDeductionsDependencies } from "@core/src/features/orders/application/recover-due-stock-deductions";
import { containedDeductionOutcome, containedServeOutcome, deductDueOrderStock, serveWaitingOrders, type DeductDueStockDependencies, type DeductionOutcome, type ServeOutcome, type StockEvent } from "@core/src/features/orders/application/deduct-due-stock";
import { getOrderAggregateByNumber } from "@core/src/features/orders/application/get-order-by-number";
import { hasAnyOrder } from "@core/src/features/orders/application/has-any-order";
import { summarizeUnpaidOrders } from "@core/src/features/orders/application/summarize-unpaid-orders";
import { describeDispatchStock, listDispatchQueue, type ListDispatchQueueDependencies, type ListDispatchQueueError, type ListDispatchQueueInput } from "@core/src/features/orders/application/list-dispatch-queue";
import { readDispatchQueueMax } from "@core/src/features/orders/infrastructure/dispatch-queue-env";
import { describeDispatchReadiness, toReadinessSubject, type DispatchStock } from "@core/src/features/orders/domain/dispatch-readiness";
import { describeOrderStockDue } from "@core/src/features/orders/application/describe-order-stock-due";
import { parseStockQuantity, type NonNegativeInteger, type StockDue, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";
import { countUndatedPendingOrders, existsOrder, findDispatchCandidates, findOrderAggregateByNumber as findAnyOrderAggregateByNumber, summarizeUnpaidOrders as summarizeUnpaidInDatabase, listCompaniesWithOverdueStockDeductions, listOverdueOrderIds, listWaitingOrderIds, loadStockOrders, lockOrdersSkipLocked, saveLineDeductions, saveStockDeductions } from "@core/src/features/orders/infrastructure/order-repository";
import { err, map, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, requireActiveTransaction, requireNoActiveTransaction, setLocalTimeouts, withinReadSnapshot, withinSavepoint, withinTransaction, withTenantIsolation, type TransactionOptions } from "@core/src/shared/infrastructure/persistance";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { setOrderDelivery, type SetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { editOrder, type EditOrderInput } from "@core/src/features/orders/application/edit-order";
import { orderRevisions } from "@core/src/features/orders/domain/order-revisions";
import type { OrderItemChanges } from "@core/src/features/orders/domain/order-edit";
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
import { deleteExpiredMessageTraces, type DeleteExpiredMessageTracesDependencies, type DeleteExpiredMessageTracesInput } from "@core/src/features/orders/application/delete-expired-message-traces";
import { reportVerdictLabels, type ReportVerdictLabelsInput } from "@core/src/features/orders/application/report-verdict-labels";
import { countVerdicts } from "@core/src/features/orders/infrastructure/verdict-counts";
import { readVerdictReportTimeoutMs } from "@core/src/features/orders/infrastructure/verdict-report-env";
import { deleteExpiredMessageTraces as deleteCompanyExpiredMessageTraces, findTraceQuotes, saveMessageTrace, listCompaniesWithExpiredMessageTraces, readAuditedMessageTraces, type TraceReadAudit } from "@core/src/features/orders/infrastructure/message-trace-repository";
import { deleteExpiredCatalogOrders, type DeleteExpiredCatalogOrdersDependencies, type DeleteExpiredCatalogOrdersInput } from "@core/src/features/orders/application/delete-expired-catalog-orders";
import type { AggregatePage } from "@core/src/features/orders/application/list-order-aggregates";
import { allocateOrderNumber, findOrderNumbers, findChatOrderTargetForUpdate, findChatOrderTarget, findChatOrdersOpenedSince, saveItemChanges as saveOrderItemChanges, saveOrderCustomer, recordProcessedMessage, savePendingOrder, saveDelivery, savePayment, updatePayment, saveCompletion, saveStockDeduction, saveFulfillment, saveDispatchSchedule, saveCancellation, findOrderAggregate as findAnyOrderAggregate, findOrderAggregates, findOrderAggregatesByIds, findOrderForUpdate as findAnyOrderForUpdate, findOrders, orderExists, readCatalogOrderConfirmation as readConfirmation, listCompaniesWithExpiredCatalogOrders, deleteExpiredCatalogOrders as deleteCompanyExpiredCatalogOrders } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariants, findSellableVariantStock, findProductIdsOfVariants, findProductNoticeNames, lockVariantStock, deductStockBulk, restoreStockBulk, findVariantStock, searchSaleCatalog } from "@core/src/features/products";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts";
import { findOrderSourceMessage } from "@core/src/features/chats";
import { findRecentChatMessages } from "@core/src/features/chats/composition";
import { loadReadingContext as loadReadingContextWith, type ReadingMessage } from "@core/src/features/orders/application/reader/load-reading-context";
import { findMaskedTexts } from "@core/src/features/orders/infrastructure/message-masked-text-lookup";
import { readReadingBudgets, readReadingLimits } from "@core/src/features/orders/infrastructure/reading-budgets-env";
import { createReadingDeadline, withAbort } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import { applyChatMessage, type ApplyChatMessageDependencies } from "@core/src/features/orders/application/apply-chat-message";
import { createChatMessageDeadLetterHandler, createChatMessageHandler, type ChatMessageHandlerDependencies } from "@core/src/features/orders/application/chat-message-handler";
import { chatMessageDeadlineMs, chatMessagePolicy } from "@core/src/features/orders/application/chat-message-policy";
import type { PublishChatMessageProcessed } from "@core/src/features/orders/application/events";
import { buildMessageTrace } from "@core/src/features/orders/application/reader/build-message-trace";
import { createLegacyShadowReader } from "@core/src/features/orders/application/reader/legacy-shadow-reader";
import { readShadowConfig } from "@core/src/features/orders/infrastructure/reader/shadow-config";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { findChatMemory, findChatPendings, findChatPendingsForUpdate, saveChatPendings } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import { confirmOrderReview, type ConfirmOrderReviewInput } from "@core/src/features/orders/application/confirm-order-review";
import { loadOrderReview, type LoadOrderReviewInput } from "@core/src/features/orders/application/load-order-review";
import { recordLinkAction, type RecordLinkActionInput } from "@core/src/features/orders/application/record-link-action";
import { findChangesAfter, findChangesByIds, findLinkNoticeArming, findLatestChatOrder, findOrderChanges, findReview, findReviewListFacts, markChangesReviewed, saveLinkAction, saveReview, settleUnreviewedChanges } from "@core/src/features/orders/infrastructure/order-review-repository";
import { pointsOfOrder, reviewStatus } from "@core/src/features/orders/domain/order-review";
import { findLaterChanges, findMessageChanges, findUnverdictedChanges, markMessageUndone, releaseSupersededChanges, saveMessageChanges, saveSellerActedAt, setUndoneVerdicts, setVerdictsForEdit } from "@core/src/features/orders/infrastructure/message-change-repository";
import { undoMessageChanges, type UndoMessageError, type UndoMessageInput } from "@core/src/features/orders/application/undo-message-changes";
import type { OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import { createChatReaderFromEnv } from "@core/src/features/orders/infrastructure/chat-reader-from-env";
import { readerStagesFromEnv } from "@core/src/features/orders/infrastructure/reader/runtime/reader-stages-from-env";
import { readChatMessageLimits } from "@core/src/features/orders/infrastructure/chat-message-limits-env";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import { findOutcome, recordFailedOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { claimNotice, releaseNotice } from "@core/src/features/orders/infrastructure/chat-message-notice-repository";
import type { ClaimedNotice } from "@core/src/features/orders/domain/seller-notice";
import { describeChatMessageNotice as describeNotice, type NoticeLocale } from "@core/src/features/orders/application/describe-chat-message-notice";
import { findSellerNoticeTarget } from "@core/src/features/orders/application/find-seller-notice-target";
import { findOpenQuestions } from "@core/src/features/orders/application/find-open-questions";
import { findChatQuestionStates, findMessageChats, findOrderQuestionFacts, findOutcomes } from "@core/src/features/orders/infrastructure/open-question-repository";
import { renderSellerNotice } from "@core/src/features/orders/presentation/seller-notice-texts";
import { products } from "@core/src/features/products/composition";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import { findAvailablePublicImage, readImageBytes, resolvePublicImages } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";
import { orderStateMachine } from "@core/src/features/orders/domain/order-state-machine";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CompanyId, ContactId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";

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
const findOrderAggregateByNumber = rejectPendingCatalogOrder(findAnyOrderAggregateByNumber);
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
    case "adjusted": return event.returnedUnits + event.deductedUnits + event.pendingLines === 0 ? undefined : afterTransactionCommit(() => log.info({ event: "order_stock_adjusted", companyId: event.companyId, orderId: event.orderId, trigger: event.trigger,
      returnedUnits: event.returnedUnits, deductedUnits: event.deductedUnits, pendingLines: event.pendingLines, durationMs: event.durationMs }, "order_stock_adjusted"));
    case "skipped_invalid": return log.error({ event: "stock_deduction_failed", companyId: event.companyId, orderId: event.orderId, trigger: "product_stock_increased",
      stage: "load_order", errorCode: "INVALID_STORED_DATA" }, "stock_deduction_failed");
  }
}

export const deductDueStockDependencies: DeductDueStockDependencies = { loadStockOrders, lockOrdersSkipLocked, lockVariantStock, deductStockBulk, restoreStock: restoreStockBulk, saveLineDeductions, saveStockDeductions, listWaitingOrderIds,
  limitStatementsToMs: (ms) => setLocalTimeouts({ statementTimeout: `${ms}ms`, lockTimeout: `${ms}ms` }),
  emit: emitStockEvent, waitingOrdersBatchSize: WAITING_ORDERS_BATCH_SIZE, waitingOrdersBudgetMs: WAITING_ORDERS_BUDGET_MS, clock: () => new Date() };

// The registry lives here because every handler belongs to orders; products receives the publisher by injection.
export const stockRegistry: InTransactionRegistry<TransactionEndingError | ContainedFailure> = {
  payment_confirmed: deductDueOrderStock("payment_confirmed", deductDueStockDependencies),
  order_delivery_changed: deductDueOrderStock("order_delivery_changed", deductDueStockDependencies),
  order_edited: deductDueOrderStock("order_edited", deductDueStockDependencies),
  order_stock_deduction_overdue: deductDueOrderStock("order_stock_deduction_overdue", deductDueStockDependencies),
  product_stock_increased: serveWaitingOrders(deductDueStockDependencies),
};

/** Builds the in-transaction publisher; tests pass a registry with a slower or failing handler. */
export const createStockPublisher = (registry: InTransactionRegistry<TransactionEndingError | ContainedFailure>) => createInTransactionPublisher(registry, {
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
  // The producer rolls back: reported both when a handler returns the ending error and when the savepoint rethrows one.
  onTransactionEnding: (name, payload, error) => {
    const ending = (error as { transactionEnding?: unknown }).transactionEnding === true || classifyPersistenceFailure(error)?.kind === "transaction_ending";
    if (ending) log.warn({ event: "stock_deduction_rolled_back", companyId: payload.companyId, eventName: name, stage: "listener", errorCode: "PERSISTENCE_UNAVAILABLE" }, "stock_deduction_rolled_back");
  },
});
const publishStock = createStockPublisher(stockRegistry);

/** Reported from the outcome once the savepoint has ended, so a rolled-back serving cannot lose it; warn when the budget ran out or serving failed. */
function logServed(companyId: string, variantCount: number, outcome: ServeOutcome, durationMs: number) {
  afterTransactionCommit(() => log[outcome.budgetExhausted || outcome.failed ? "warn" : "info"]({ event: "waiting_orders_served", companyId, variantCount,
    candidates: outcome.candidates, deducted: outcome.deducted, skippedLocked: outcome.skippedLocked, skippedInvalid: outcome.skippedInvalid,
    budgetExhausted: outcome.budgetExhausted, ...(outcome.failed ? { stage: outcome.failed.stage, errorCode: outcome.failed.errorCode } : {}), durationMs }, "waiting_orders_served"));
}

export const publishStockEvent: typeof publishStock = (async (name: Parameters<typeof publishStock>[0], payload: Parameters<typeof publishStock>[1]) => {
  const started = performance.now();
  const result = await publishStock(name, payload);
  if (name === "product_stock_increased" && result.success)
    logServed(payload.companyId, (payload as { variantIds: readonly unknown[] }).variantIds.length, result.data as ServeOutcome, Math.round(performance.now() - started));
  return result;
}) as typeof publishStock;

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

export const recoveryDependencies: RecoverDueStockDeductionsDependencies = {
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

/** Stock of these variants with every quantity validated; one unreadable quantity fails the read instead of counting as zero. */
async function readValidStock(variantIds: readonly VariantId[]): Promise<Result<VariantStock, ListDispatchQueueError>> {
  const rows = await readStock(variantIds);
  if (!rows.success) return err({ code: "PERSISTENCE_UNAVAILABLE", message: rows.error.message });
  const stock = new Map<VariantId, NonNegativeInteger>();
  for (const [variantId, raw] of rows.data) {
    const quantity = parseStockQuantity(raw);
    if (!quantity.success) return err({ code: "INVALID_ORDER", message: "Invalid stored stock quantity" });
    stock.set(variantId, quantity.data);
  }
  return ok(stock);
}

const dispatchQueueDependencies: ListDispatchQueueDependencies = { inSnapshot: withinReadSnapshot, findDispatchCandidates, readStock: readValidStock,
  findAggregatesByIds: (ids, companyId) => findOrderAggregatesByIds(ids, companyId), countUndatedPending: countUndatedPendingOrders, maxCandidates: readDispatchQueueMax(process.env) };

/** The dispatch queue of the caller's company in one read snapshot: candidates, stock and the page's orders agree with each other. */
async function readDispatchQueue(input: ListDispatchQueueInput, context: OrderAccess) {
  if (getCompanyId() !== context.companyId) throw new Error("Order company differs from tenant context");
  try {
    const page = await listDispatchQueue(input, context, dispatchQueueDependencies);
    if (!page.success && page.error.code === "QUEUE_TOO_LARGE") log.warn({ event: "dispatch_queue_too_large", companyId: context.companyId, maxCandidates: dispatchQueueDependencies.maxCandidates }, "dispatch_queue_too_large");
    return page;
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_list_dispatch_queue", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_list_dispatch_queue");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read the dispatch queue" });
  }
}

/** Stock due and current-stock shortfall of full orders, in one snapshot with one stock read. */
async function describeOrdersDispatchStock(found: readonly OrderAggregate[]) {
  try {
    return await describeDispatchStock(found, { inSnapshot: withinReadSnapshot,
      readStock: async (variantIds) => { const stock = await readValidStock(variantIds); return stock.success ? stock : err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: stock.error.message }); } });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_describe_dispatch_stock", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_describe_dispatch_stock");
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
type FulfillmentOperation = "ship_order" | "deliver_order" | "update_order_shipping";
/** Shipping and delivering run outside any savepoint, so a failed statement there simply ends its transaction: it answers like any other persistence failure. */
function forFulfillment<A extends unknown[], T>(operation: FulfillmentOperation, call: (...args: A) => Promise<Result<T, TransactionEndingError | ContainedFailure>>, stage: string) {
  return async (...args: A): Promise<Result<T, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> => {
    const result = await call(...args);
    if (result.success) return result;
    const failure = result.error;
    if (failure.code === "PERSISTENCE_UNAVAILABLE") return err(failure);
    log.error({ event: "unable_to_deduct_product_stock", operation, stage, errorCode: failure.errorCode, err: failure.cause }, "unable_to_deduct_product_stock");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: failure.message });
  };
}

// Shipping and delivering deduct pending stock, so each deduction logs under the operation that asked for it, like set_order_delivery does.
const fulfillmentDependenciesFor = (operation: FulfillmentOperation): FulfillOrderDependencies => ({ transaction: fulfillmentTransaction, findOrderForUpdate,
  saveFulfillment, settleUnreviewedChanges, clock: () => new Date(),
  lockVariantStock: forFulfillment(operation, lockVariantStock, "lock_stock"), deductStockBulk: forFulfillment(operation, deductStockBulk, "deduct_stock"),
  saveStockDeduction: (id, companyId, at) => saveStockDeduction(id, companyId, at, operation) });

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
      findOrderForUpdate, savePayment, updatePayment, saveCompletion, settleUnreviewedChanges, publishPaymentConfirmed: (payload) => publishStockEvent("payment_confirmed", payload), findVariantStock, clock: () => new Date() }),
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

function reportedAt(payment: OrderAggregate["payments"][number]) {
  if (payment.status === "reported") return payment.data.reportedAt;
  if (payment.status === "rejected") return payment.data.report.reportedAt;
  return payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.reportedAt : null;
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
          receiptImageUrl: imageId ? images.get(imageId) ?? null : null, rejectionReason: payment.status === "rejected" ? payment.data.reason : null,
          reportedAt: reportedAt(payment)?.toISOString() ?? null }; }),
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

/** Worker sweep: each company's batch runs in its own transaction under RLS; an unexpected error fails only that company. */
export function deleteConfiguredExpiredMessageTraces(input: DeleteExpiredMessageTracesInput) {
  const dependencies: DeleteExpiredMessageTracesDependencies = { listCompaniesWithExpiredMessageTraces,
    deleteExpiredMessageTraces: async (companyId, cutoff, limit) => {
      try {
        return await withTenantIsolation(companyId, () => withinTransaction(() => deleteCompanyExpiredMessageTraces(companyId, cutoff, limit)));
      } catch (cause) {
        log.error({ event: "unable_to_delete_message_traces", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to delete message traces");
        return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to delete message traces" });
      }
    } };
  return deleteExpiredMessageTraces(input, dependencies);
}

/** The trace CLI: the audit row and the reads share one tenant transaction, so a failed audit reads nothing. */
export function readMessageTraces(companyId: CompanyId, audit: TraceReadAudit) {
  return withTenantIsolation(companyId, () => withinTransaction(() => readAuditedMessageTraces(audit)));
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

/** The chat path knows only retryable persistence failures: a variant deleted before the insert is retried, as the next scan no longer finds it. */
export const saveChatItemChanges = async (order: OrderAggregate, changes: OrderItemChanges): Promise<Result<null, Persistence>> => {
  const saved = await saveOrderItemChanges(order, changes);
  if (saved.success) return saved;
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: saved.error.message });
};

const conflictCodes = ["ORDER_CHANGED", "DELIVERY_LOCKED", "ORDER_CANCELLED"];
const failureCodes = ["PERSISTENCE_UNAVAILABLE", "INVALID_STORED_DATA", "SERVICE_UNAVAILABLE"];

/** The stage an edit stopped at: the use case's own checks are told apart by their error code, the others by the last capability the composition saw. */
function editStage(code: string, observed: string): string {
  if (code === "ORDER_CHANGED") return "check_revisions";
  if (code === "DELIVERY_LOCKED" || code === "ORDER_CANCELLED") return "check_locks";
  if (code === "CUSTOMER_REQUIRED") return "check_customer";
  if (code === "VARIANT_NOT_FOUND") return "resolve_variants";
  if (code === "INVALID_ORDER" || code === "CURRENCY_MISMATCH") return "check_applied"; // refused while applying the parts in memory, whatever capability ran before
  if (["TOTAL_CHANGED", "RATE_UNAVAILABLE", "DELIVERY_UNAVAILABLE", "DELIVERY_METHOD_DISABLED"].includes(code)) return "resolve_delivery";
  return observed;
}

export async function editConfiguredOrder(input: EditOrderInput, access: OrderAccess) {
  const started = performance.now();
  const observed: { previous: OrderAggregate | null; changes: OrderItemChanges | null; stage: string; lockWaitMs: number; saveItemsMs: number; deductStockMs: number } =
    { previous: null, changes: null, stage: "lock_order", lockWaitMs: 0, saveItemsMs: 0, deductStockMs: 0 };
  const timed = async <T,>(call: () => Promise<T>, record: (ms: number) => void): Promise<T> => {
    const begun = performance.now();
    try { return await call(); } finally { record(Math.round(performance.now() - begun)); }
  };
  const result = await editOrder(input, access, {
    transaction: (companyId, work) => {
      if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
      return orderTransaction(work, { orderId: input.orderId, userId: access.userId }, producerOptions);
    },
    findOrderForUpdate: async (id, companyId) => {
      const found = await timed(() => findOrderForUpdate(id, companyId, "edit_order"), (ms) => { observed.lockWaitMs = ms; });
      if (found.success) observed.previous = found.data;
      return found;
    },
    findSellableVariants: (ids) => { observed.stage = "resolve_variants"; return findSellableVariants(ids); },
    resolveRatedDelivery: async (selection, context, currency, expectedPrice) => {
      observed.stage = "resolve_delivery";
      return resolveRatedShippingCost(selection, { companyId: context.companyId, author: { kind: "seller", userId: context.userId } }, currency, expectedPrice, {
        getStoreSettings: () => deliverySettings.get(context, "edit_order"),
        resolveSelectedDeliveryRate: deliverySettings.resolveSelectedDeliveryRate,
      });
    },
    saveItemChanges: async (order, changes) => {
      observed.stage = "save_items";
      observed.changes = changes;
      return timed(() => saveOrderItemChanges(order, changes), (ms) => { observed.saveItemsMs = ms; });
    },
    saveOrderCustomer: (id, companyId, buyer) => { observed.stage = "save_customer"; return saveOrderCustomer(id, companyId, buyer); },
    saveDelivery: (id, companyId, change) => { observed.stage = "save_delivery"; return saveDelivery(id, companyId, change); },
    publishStockEvent: (payload) => { observed.stage = "deduct_stock"; return timed(() => publishStockEvent("order_edited", payload), (ms) => { observed.deductStockMs = ms; }); },
    publishStockIncreased: (variantIds) => { observed.stage = "restock"; return publishStockEvent("product_stock_increased", { companyId: access.companyId, variantIds }); },
    findVariantStock,
    newItemId: () => randomUUID() as OrderItemId,
    setVerdictsForEdit,
    saveSellerActedAt,
    clock: () => new Date(),
  });
  const durationMs = Math.round(performance.now() - started);
  const parts = (["items", "customer", "delivery"] as const).filter((part) => input[part] !== undefined);
  const base = { operation: "edit_order", orderId: input.orderId, userId: access.userId, parts };
  if (result.success) {
    const before = observed.previous;
    const changes = observed.changes;
    const outcome = result.data.outcome;
    afterTransactionCommit(() => log.info({ event: "order_edit_saved", ...base, applied: result.data.applied, addedItems: changes?.added.length ?? 0, removedItems: changes?.removedItemIds.length ?? 0,
      changedQuantities: changes?.updated.length ?? 0, deliveryChange: input.delivery?.change.kind ?? null,
      customerChange: !input.customer || !result.data.applied.includes("customer") ? null : input.customer.value ? "set" : "cleared",
      stockOutcome: outcome?.kind ?? null, stockDeducted: result.data.order.stockDeducted, totalChanged: before?.total.amount !== result.data.order.total.amount,
      lockWaitMs: observed.lockWaitMs, stageMs: { lock_order: observed.lockWaitMs, save_items: observed.saveItemsMs, deduct_stock: observed.deductStockMs },
      durationMs, transactionOutcome: "committed" }, "Order edit saved"));
    return result;
  }
  const error = result.error;
  const previous = observed.previous;
  if (conflictCodes.includes(error.code)) {
    log.info({ event: "order_edit_conflicted", ...base, errorCode: error.code, conflictParts: error.code === "ORDER_CHANGED" ? error.parts : undefined,
      deliveryStatus: previous?.deliveryStatus, stockDeducted: previous?.stockDeducted, cancelled: previous?.cancelled, lockWaitMs: observed.lockWaitMs, durationMs }, "Order edit conflicted");
  } else if (failureCodes.includes(error.code)) {
    log.error({ event: "order_edit_failed", ...base, errorCode: error.code, stage: editStage(error.code, observed.stage), durationMs, err: error }, "Order edit failed");
  } else {
    log.debug({ event: "order_edit_rejected", ...base, errorCode: error.code, stage: editStage(error.code, observed.stage), durationMs }, "Order edit rejected");
  }
  return result;
}

/** Undo runs in a producer-style transaction: lock waits end below Prisma's timer. The order lock comes first, then the chat's pendings, as the message apply does. */
async function undoConfiguredMessage(input: UndoMessageInput, access: OrderAccess) {
  const undone = await undoMessageChanges(input, access, {
    transaction: (companyId, work) => producerTransaction(companyId, work),
    findOrderForUpdate,
    findChatPendingsForUpdate,
    findMessageChanges,
    findLaterChanges,
    findSellableVariants,
    saveItemChanges: saveOrderItemChanges,
    saveChatPendings,
    markMessageUndone,
    setUndoneVerdicts,
    releaseSupersededChanges,
    saveSellerActedAt,
    clock: () => new Date(),
    newItemId: () => randomUUID() as OrderItemId,
    pendingTtlMs: chatMessageDependencies.limits.pendingTtlMs,
  });
  if (undone.success && undone.data.undone) afterTransactionCommit(() => log.info({ event: "order_message_undone", companyId: access.companyId, orderId: input.orderId,
    messageId: input.messageId, userId: access.userId, changeCount: undone.data.changeCount, pendingsRestored: undone.data.pendingsRestored, pendingsEnded: undone.data.pendingsEnded }, "order_message_undone"));
  return undone satisfies Result<unknown, UndoMessageError>;
}

/** The review of an order, read from one snapshot. The web loader, the review route and the answer of an undo all call it. */
function loadConfiguredOrderReview(input: LoadOrderReviewInput, access: OrderAccess) {
  return loadOrderReview(input, access, { inSnapshot: withinReadSnapshot, findOrder: async (id, companyId) => { const found = await findOrderAggregate(id, companyId); return found.success ? found : err({ code: found.error.code === "INVALID_ORDER" ? "INVALID_STORED_DATA" : found.error.code, message: found.error.message }); }, findOrderChanges, findChatPendings, findLatestChatOrder, findTraceQuotes,
    findSellableVariants, findProductNames: findProductNoticeNames, clock: () => new Date(), pendingTtlMs: chatMessageDependencies.limits.pendingTtlMs });
}

/** Review confirmation runs in a producer-style transaction, because its corrections publish stock events like an edit does. */
async function confirmConfiguredOrderReview(input: ConfirmOrderReviewInput, access: OrderAccess) {
  const confirmed = await confirmOrderReview(input, access, {
    transaction: (companyId, work) => producerTransaction(companyId, work),
    findOrderForUpdate, findChatPendingsForUpdate, findLatestChatOrder, findReview, findChangesAfter, findChangesByIds, saveReview, markChangesReviewed, saveChatPendings, saveLinkAction,
    findSellableVariants, newItemId: () => randomUUID() as OrderItemId, saveItemChanges: saveOrderItemChanges, setVerdictsForEdit, saveSellerActedAt, clock: () => new Date(),
    publishStockEvent: (payload) => publishStockEvent("order_edited", payload),
    publishStockIncreased: (variantIds) => publishStockEvent("product_stock_increased", { companyId: access.companyId, variantIds }),
    findVariantStock, pendingTtlMs: chatMessageDependencies.limits.pendingTtlMs });
  if (confirmed.success) afterTransactionCommit(() => log.info({ event: "order_review_confirmed", companyId: access.companyId, orderId: input.orderId, reviewId: input.reviewId, userId: access.userId,
    origin: input.origin, correctedItems: input.corrections.length, shownChanges: input.loaded.changeIds.length, doubtfulShown: confirmed.data.doubtfulShown, pointsAcknowledged: confirmed.data.pointsAcknowledged, changedMeanwhile: confirmed.data.changedMeanwhile.length, linkAction: input.linkAction?.action ?? null }, "order_review_confirmed"));
  return confirmed;
}

/** The orders of a list page that have something to review: the batched read of section 11, a fixed number of queries whatever the page size. */
async function findOrdersToReview(items: readonly OrderAggregate[]): Promise<ReadonlySet<OrderId>> {
  const chats = items.filter((order) => order.chatId && !order.cancelled && order.completedAt === null);
  if (chats.length === 0) return new Set();
  const facts = await findReviewListFacts(chats.map((order) => order.id), [...new Set(chats.map((order) => order.chatId!))]);
  if (!facts.success) {
    log.warn({ event: "order_review_list_unavailable", companyId: getCompanyId(), errorCode: facts.error.code }, "order_review_list_unavailable");
    return new Set();
  }
  const now = new Date();
  return new Set(chats.filter((order) => {
    const points = pointsOfOrder(facts.data.pendings.get(order.chatId!) ?? [], order, facts.data.latestByChat.get(order.chatId!) ?? null, now, chatMessageDependencies.limits.pendingTtlMs);
    return reviewStatus({ order, unreviewed: facts.data.unreviewed.get(order.id) ?? [], hasPreviousReview: facts.data.reviewed.has(order.id),
      points: points.map((pending) => ({ key: { pendingId: pending.id, since: pending.pointSince }, kind: "variant_missing", product: null, quantity: pending.quantity, missing: [], doubt: pending.doubt?.reason ?? null,
        acknowledged: (pending.acknowledgedAt?.getTime() ?? -1) >= pending.pointSince.getTime(), question: { language: "es", kind: "photo_product_name" } })) }).toReview;
  }).map((order) => order.id));
}

/** Whether the stored order already locks its products: the card shows no stock warning then, so the stock is not read. */
const productsLocked = (order: Pick<OrderAggregate, "cancelled" | "deliveryStatus">) => order.cancelled || order.deliveryStatus !== "pending";

/**
 * Stock of the order's sellable variants, for the «sin stock» warnings. `null` means "unknown" (the read failed or the products are locked);
 * a variant missing from the answer is not sellable. It never fails the caller.
 */
async function lineCatalog(order: Pick<OrderAggregate, "id" | "items" | "cancelled" | "deliveryStatus" | "stockDeducted">, entryPoint: "detail_loader" | "save_result"):
  Promise<Readonly<Record<string, Readonly<{ stock: number }>>> | null> {
  if (productsLocked(order)) return null;
  const variantIds = order.items.map((item) => item.variantId);
  const stock = await findSellableVariantStock(variantIds);
  if (!stock.success) {
    log.warn({ event: "order_line_catalog_unavailable", orderId: order.id, entryPoint, errorCode: stock.error.code, variantCount: variantIds.length }, "order_line_catalog_unavailable");
    return null;
  }
  return Object.fromEntries([...stock.data].map(([variantId, quantity]) => [variantId, { stock: quantity }]));
}

export const orders = {
  // Notice capabilities for notifications. They run inside the company's tenant context.
  claimChatMessageNotice: (messageId: ChatMessageId) => claimNotice(messageId),
  describeChatMessageNotice: (claim: ClaimedNotice, locale: NoticeLocale) => describeNotice(claim, locale, {
    companyId: getCompanyId, findOrderNumbers, findProductNames: findProductNoticeNames, render: renderSellerNotice }),
  releaseChatMessageNotice: (messageId: ChatMessageId) => releaseNotice(messageId),
  findSellerNoticeTarget: (messageId: ChatMessageId) => findSellerNoticeTarget(messageId, { findOutcome, orderExists }),
  findOpenQuestions: (messageIds: readonly ChatMessageId[]) => findOpenQuestions(messageIds, { findOutcomes, findMessageChats, findChatQuestionStates, findOrderQuestionFacts }),
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
  edit: (input: EditOrderInput, access: OrderAccess) => editConfiguredOrder(input, access),
  undoMessage: (input: UndoMessageInput, access: OrderAccess) => undoConfiguredMessage(input, access),
  loadOrderReview: loadConfiguredOrderReview,
  confirmOrderReview: confirmConfiguredOrderReview,
  recordLinkAction: async (input: RecordLinkActionInput, access: OrderAccess) => {
    const recorded = await recordLinkAction(input, access, { orderExists: async (orderId) => orderExists(orderId), saveLinkAction, clock: () => new Date() });
    if (recorded.success) log.info({ event: "order_link_action_recorded", companyId: access.companyId, orderId: input.orderId, userId: access.userId, action: input.action }, "order_link_action_recorded");
    return recorded;
  },
  revisions: orderRevisions,
  lineCatalog,
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
  /** The page with the set of its orders that need the seller's review (`toReview`). */
  listAggregates: async (criteria: Parameters<typeof listOrderAggregates>[0], context: Parameters<typeof listOrderAggregates>[1]) => {
    const page = await listOrderAggregates(criteria, context, findOrderAggregates);
    return page.success ? ok<AggregatePage & Readonly<{ toReview?: ReadonlySet<OrderId> }>>({ ...page.data, toReview: await findOrdersToReview(page.data.items) }) : page;
  },
  /** Read-only: the company's orders among these ids with their derived state, one query. */
  getAggregatesByIds: (ids: readonly OrderId[], companyId: CompanyId) => findOrderAggregatesByIds(ids, companyId),
  getAggregate: (id: Parameters<typeof getOrderAggregate>[0], context: Parameters<typeof getOrderAggregate>[1]) =>
    getOrderAggregate(id, context, findOrderAggregate),
  /** Read-only. An unconfirmed catalog order and another company's number both answer `ORDER_NOT_FOUND`. */
  getAggregateByNumber: (input: Parameters<typeof getOrderAggregateByNumber>[0], context: Parameters<typeof getOrderAggregateByNumber>[1]) =>
    getOrderAggregateByNumber(input, context, findOrderAggregateByNumber),
  /** Read-only: whether the company has an order the seller can see. */
  hasAny: (input: Parameters<typeof hasAnyOrder>[0], context: Parameters<typeof hasAnyOrder>[1]) => hasAnyOrder(input, context, existsOrder),
  /** Read-only: count, balance and pending reports over every unpaid order. */
  summarizeUnpaid: (input: Parameters<typeof summarizeUnpaidOrders>[0], context: Parameters<typeof summarizeUnpaidOrders>[1]) =>
    summarizeUnpaidOrders(input, context, summarizeUnpaidInDatabase),
  /** Read-only: pending orders scheduled today or earlier with their readiness, 20 per page. */
  listDispatchQueue: readDispatchQueue,
  /** Read-only: `stockDue` and the current-stock shortfall of full orders. */
  describeDispatchStock: describeOrdersDispatchStock,
  /** Pure: the readiness of a full order given its `describeDispatchStock` entry; `null` when it is cancelled or no longer pending. */
  describeDispatchReadiness: (order: OrderAggregate, stock: DispatchStock) => describeDispatchReadiness(toReadinessSubject(order), stock),
  ship: (id: Parameters<typeof registerShipment>[0], context: Parameters<typeof registerShipment>[1]) =>
    registerShipment(id, context, fulfillmentDependenciesFor("ship_order")),
  updateShipping: (input: Parameters<typeof updateOrderShipping>[0], context: Parameters<typeof updateOrderShipping>[1]) =>
    updateOrderShipping(input, context, { ...fulfillmentDependenciesFor("update_order_shipping"), saveDispatchSchedule } satisfies UpdateOrderShippingDependencies),
  deliver: (id: Parameters<typeof registerDelivery>[0], context: Parameters<typeof registerDelivery>[1]) =>
    registerDelivery(id, context, fulfillmentDependenciesFor("deliver_order")),
  cancel: async (id: Parameters<typeof cancelOrder>[0], context: Parameters<typeof cancelOrder>[1]) => {
    requireNoActiveTransaction();
    let failure: EventBusError | undefined;
    const publishOrderCancelled: CancelOrderDependencies["publishOrderCancelled"] = async (payload) => {
      const published = await applicationEventBus().publishEvent("order_cancelled", payload);
      if (!published.success) failure = published.error;
      return published;
    };
    const result = await cancelOrder(id, context, { transaction: cancellationTransaction, findOrderForUpdate, saveCancellation, settleUnreviewedChanges, publishOrderCancelled, clock: () => new Date() });
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
      savePayment: markSaved, updatePayment: markUpdated, saveCompletion, settleUnreviewedChanges,
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

// The products composition imports the event handlers that import this module, so `products` is only read when a message is applied.
const readChatMessage = createChatReaderFromEnv(process.env);
const readingBudgets = readReadingBudgets(process.env);
const readingLimits = (() => {
  const limits = readReadingLimits(process.env);
  if (!limits.success) throw new Error(limits.error.message);
  return limits.data;
})();
/** The staged reader's ports from the env; null without OPENAI_API_KEY and no fake. Built on first use so that nothing starts, or fails startup, before a message is read. */
let stagedPorts: ReturnType<typeof readerStagesFromEnv> | undefined;
export const createReaderStagePorts = () => (stagedPorts ??= readerStagesFromEnv(process.env, readingBudgets.stageInputMaxChars));

let shadowReaderCache: ApplyChatMessageDependencies["shadowReader"] | undefined;
/** The legacy shadow reader, built on first use: null when `READER_SHADOW_LEGACY` is off or no model provider is configured. */
function legacyShadowReader(): ApplyChatMessageDependencies["shadowReader"] {
  if (shadowReaderCache !== undefined) return shadowReaderCache;
  const config = readShadowConfig(process.env);
  if (!config.success) throw new Error(config.error.message);
  const limits = readChatMessageLimits(process.env);
  const model = readChatReaderEnv(process.env).AI_READER_MODEL;
  shadowReaderCache = config.data.legacy && readChatMessage
    ? createLegacyShadowReader({ readChatMessage, findChatOrderTarget: (chatId) => findChatOrderTarget(chatId, findProductIdsOfVariants), findChatOrdersOpenedSince, findChatPendings,
      findProductsForReading: (ids) => products.findProductsForReading(ids), findMessageCandidates: (text) => products.findMessageCandidates(text),
      costOf: (usage) => { const price = priceOf(model); return price ? (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000 : null; },
      clock: () => new Date(), limits })
    : null;
  return shadowReaderCache;
}

const chatMessageDependencies: ApplyChatMessageDependencies = {
  findOutcome,
  findSourceMessage: async (id) => {
    const found = await findOrderSourceMessage(id);
    if (!found.success || !found.data) return found as Result<null, Persistence>;
    const message = found.data;
    return ok({ ...message, companyId: message.companyId as string as CompanyId, chatId: message.chatId as ChatId,
      contactId: message.contactId as ContactId, uploadedByUserId: message.uploadedByUserId as string as UserId, imageId: message.imageId as ImageId | null });
  },
  findChatOrderTarget: (chatId) => findChatOrderTarget(chatId, findProductIdsOfVariants),
  findChatOrdersOpenedSince,
  findChatPendings,
  findChatPendingsForUpdate,
  findChatMemory,
  saveChatPendings,
  readImage: (imageId) => readImageBytes(imageId),
  identifyProductsInImage: (image, signal) => products.identifyProductsInImage(image, signal),
  loadReadingContext: (message, target, pendings, photoMemory) => loadReadingContext(message, target, pendings, photoMemory),
  findMentionCandidates: (mentions) => products.findMentionCandidates(mentions),
  findProductsForReading: (productIds) => products.findProductsForReading(productIds),
  catalogSearchReadiness: () => products.catalogSearchReadiness(),
  get stages() { return createReaderStagePorts(); },
  readChatMessage,
  createDeadline: (budgetMs, meta, jobSignal) => createReadingDeadline(budgetMs, meta, Date.now, jobSignal).signal,
  withAbort,
  transaction: scopedOrderTransaction,
  lockContact,
  ensureCustomerForContact: async (contactId) => {
    const ensured = await ensureCustomerForContact(contactId);
    return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured;
  },
  findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
  allocateNumber: () => allocateOrderNumber(getCompanyId() as CompanyId),
  saveNewOrder: (order, link) => savePendingOrder(order, link),
  saveItemChanges: saveChatItemChanges,
  recordOrderMessage: recordProcessedMessage,
  findUnverdictedChanges,
  findLinkNoticeArming,
  saveMessageChanges,
  newChangeId: () => randomUUID() as OrderItemChangeId,
  recordOutcome,
  newOrderId: () => randomUUID() as OrderId,
  newItemId: () => randomUUID() as OrderItemId,
  newPendingId: () => randomUUID() as ChatPendingId,
  clock: () => new Date(),
  buildMessageTrace,
  saveMessageTrace,
  // Phase 5 only: the legacy reader runs beside the staged one and never applies anything. T17 removes it.
  get shadowReader() { return legacyShadowReader(); },
  limits: { ...readChatMessageLimits(process.env), ...readingLimits },
};

type ReadingContextLoader = (message: ReadingMessage, target: Parameters<typeof loadReadingContextWith>[2], pendings: Parameters<typeof loadReadingContextWith>[3],
  photoMemory: Parameters<typeof loadReadingContextWith>[4]) => ReturnType<typeof loadReadingContextWith>;

/** The loader of the reading input on a given clock (a test moves the clock; production uses the real one). */
export const createReadingContextLoader = (clock: () => Date): ReadingContextLoader => (message, target, pendings, photoMemory) => loadReadingContextWith({ findRecentChatMessages, findMaskedTexts, findOutcome,
  findChatOrdersOpenedSince, clock, pendingTtlMs: chatMessageDependencies.limits.pendingTtlMs, budgets: readingBudgets }, message, target, pendings, photoMemory);

/** The input of the staged reader's three stages for a message: recent chat messages, masks, the latest photo outcome, order lines and pendings. */
export const loadReadingContext: ReadingContextLoader = (message, target, pendings, photoMemory) => createReadingContextLoader(chatMessageDependencies.clock)(message, target, pendings, photoMemory);

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

/** The verdicts CLI: counts over every company through the definer aggregate, with its own statement timeout read at call time. */
export function reportConfiguredVerdictLabels(input: ReportVerdictLabelsInput) {
  const timeoutMs = readVerdictReportTimeoutMs(process.env);
  return reportVerdictLabels(input, { countVerdicts: (since, until) => countVerdicts(since, until, timeoutMs) });
}
