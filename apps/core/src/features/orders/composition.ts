import { applicationEventBus } from "@core/src/composition/event-bus";
import type { EventBusError } from "@core/src/shared/events/application/contracts";
import { createCompleteOrder, type CreateCompleteOrderInput, type CreateCompleteOrderError } from "@core/src/features/orders/application/create-complete-order";
import { enableOrderCheckout, getOrderCheckout, confirmOrderCheckout, confirmCheckoutDelivery, type CheckoutDependencies, type CheckoutPhotoError, type GetOrderCheckoutDependencies, type ConfirmOrderCheckoutInput, type ConfirmCheckoutDeliveryInput } from "@core/src/features/orders/application/checkout";
import { findCheckoutOrder, findCheckoutOrderForUpdate as findAnyCheckoutOrderForUpdate, saveCheckoutBuyer, saveCheckoutConfirmed } from "@core/src/features/orders/infrastructure/checkout-repository";
import { canAccessBuyerPayment, type CheckoutAccess, type CheckoutError } from "@core/src/features/orders/domain/checkout";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { err, map, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, requireNoActiveTransaction, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
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
import { deductStock, type DeductStockDependencies } from "@core/src/features/orders/application/deduct-stock";
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
import { allocateOrderNumber, findProcessedMessage, findOpenChatOrderCandidate, saveAddedItems, recordProcessedMessage, savePendingOrder, saveDelivery, savePayment, updatePayment, saveCompletion, saveStockDeduction, saveFulfillment, saveDispatchSchedule, saveCancellation, findOrderedVariantIds, findOrderAggregate as findAnyOrderAggregate, findOrderAggregates, findOrderAggregatesByIds, findOrderForUpdate as findAnyOrderForUpdate, findOrders, orderExists, readCatalogOrderConfirmation as readConfirmation, listCompaniesWithExpiredCatalogOrders, deleteExpiredCatalogOrders as deleteCompanyExpiredCatalogOrders } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, findSellableVariants, deductProductStock, searchSaleCatalog } from "@core/src/features/products";
import { ensureCustomerForContact } from "@core/src/features/contacts";
import { findOrderSourceMessage } from "@core/src/features/chats";
import { addMessageProductsToOrder, type AddMessageProductsDependencies, type AddMessageProductsError, type MessageProductMatch } from "@core/src/features/orders/application/add-message-products-to-order";
import { messageOrderPolicy } from "@core/src/features/orders/application/message-order-policy";
import { products } from "@core/src/features/products/composition";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { EventHandler } from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import { findAvailablePublicImage, readImageBytes, resolvePublicImages } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";
import { orderStateMachine } from "@core/src/features/orders/domain/order-state-machine";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CompanyId, ContactId, OrderId, OrderItemId, PaymentId, UserId } from "@core/src/features/orders/domain/order";

async function orderTransaction<T, E extends AppError>(callback: () => Promise<Result<T, E>>, deliveryContext?: Readonly<{ orderId: string; userId: string }>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  try {
    return await withinTransaction(callback);
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
const pendingTransaction: CreateOrderDependencies["transaction"] = scopedOrderTransaction;
const stockTransaction: DeductStockDependencies["transaction"] = scopedOrderTransaction;
const paymentTransaction: RegisterPaymentDependencies["transaction"] = scopedOrderTransaction;
const reportTransaction: ReportPaymentDependencies["transaction"] = scopedOrderTransaction;
const voidTransaction: VoidPaymentDependencies["transaction"] = scopedOrderTransaction;
const rejectTransaction: RejectPaymentDependencies["transaction"] = scopedOrderTransaction;
const immediateTransaction: RegisterImmediateSaleDependencies["transaction"] = scopedOrderTransaction;
const cancellationTransaction: CancelOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentTransaction: FulfillOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentDependencies: FulfillOrderDependencies = { transaction: fulfillmentTransaction, findOrderForUpdate,
  saveFulfillment, clock: () => new Date() };

export async function setConfiguredOrderDelivery(input: SetDeliveryInput, context: OrderAccess) {
  const started = performance.now();
  const observed: { previous: OrderAggregate | null; settingsVersion?: number; courierId?: string; optionId?: string; agencyId?: string; stage: string } = { previous: null, stage: "lock_order" };
  const result = await setOrderDelivery(input, context, {
    transaction: (companyId, work) => {
      if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
      return orderTransaction(work, { orderId: input.orderId, userId: context.userId });
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
    deductProductStock: (variantId, quantity) => { observed.stage = "deduct_stock"; return deductProductStock(variantId, quantity, { operation: "set_order_delivery", orderId: input.orderId }); },
    saveStockDeduction: (id, companyId) => { observed.stage = "save_stock_deduction"; return saveStockDeduction(id, companyId, "set_order_delivery"); },
  });
  const durationMs = Math.round(performance.now() - started);
  if (result.success) {
    const before = observed.previous;
    afterTransactionCommit(() => log.info({ event: "order_delivery_saved", operation: "set_order_delivery", orderId: input.orderId,
      userId: context.userId, authorKind: "seller", changeKind: before?.delivery ? "replaced" : "assigned",
      courierId: observed.courierId, optionId: observed.optionId, agencyId: observed.agencyId, previousDeliveryMethod: before?.delivery?.method, deliveryMethod: input.delivery.method, settingsVersion: observed.settingsVersion,
      totalChanged: before?.total.amount !== result.data.total.amount,
      stockDeductionRequired: !before?.stockDeducted && result.data.stockDeducted, stockDeducted: result.data.stockDeducted,
      transactionOutcome: "committed", durationMs }, "Order delivery saved"));
  } else if (!["ORDER_NOT_FOUND", "PERSISTENCE_UNAVAILABLE", "INVALID_STORED_DATA", "INVALID_ORDER", "CURRENCY_MISMATCH"].includes(result.error.code)) {
    log.debug({ event: "order_delivery_rejected", operation: "set_order_delivery", orderId: input.orderId, userId: context.userId,
      courierId: observed.courierId, optionId: observed.optionId, agencyId: observed.agencyId, deliveryMethod: input.delivery.method, settingsVersion: observed.settingsVersion, deliveryStatus: observed.previous?.deliveryStatus, cancelled: observed.previous?.cancelled,
      errorCode: result.error.code, stage: observed.stage,
      ...(result.error.code === "DELIVERY_UNAVAILABLE" ? { reason: result.error.reason } : {}),
      ...(result.error.code === "INSUFFICIENT_STOCK" ? { variantId: result.error.variantId } : {}) }, "Order delivery rejected");
  }
  return result;
}

export function createConfiguredOrder(input: CreateCompleteOrderInput, context: OrderAccess): Promise<Result<OrderAggregate, CreateCompleteOrderError>> {
  return createCompleteOrder(input, context, {
    transaction: scopedOrderTransaction,
    create: orders.create,
    setDelivery: (delivery, access) => setConfiguredOrderDelivery(delivery, access),
    registerPayment: (payment, access) => registerPayment(payment, access, { transaction: paymentTransaction,
      findOrderForUpdate, savePayment, updatePayment, saveCompletion, deductProductStock, saveStockDeduction, clock: () => new Date() }),
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
  confirmCheckoutDelivery: async (input: ConfirmCheckoutDeliveryInput, access: CheckoutAccess) => {
    requireNoActiveTransaction();
    bindRequestOperation({ operation: "confirm_checkout" });
    const result = await withTenantIsolation(access.companyId, () => confirmCheckoutDelivery(input, access, new Date(), {
      transaction: scopedOrderTransaction, findOrderForUpdate: findAnyCheckoutOrderForUpdate,
      saveBuyer: saveCheckoutBuyer, saveConfirmed: saveCheckoutConfirmed,
      saveDelivery, deductProductStock, saveStockDeduction,
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
      findVariant: findSellableVariant, saveOrder: savePendingOrder, allocateNumber: allocateOrderNumber,
      savePayment, deductProductStock, saveStockDeduction, saveFulfillment,
      newItemId: () => randomUUID() as OrderItemId, newPaymentId: () => randomUUID() as PaymentId, clock: () => new Date() }),
  registerPayment: async (input: Parameters<typeof registerPayment>[0], context: Parameters<typeof registerPayment>[1]) => {
    let applied = false;
    const markSaved: typeof savePayment = async (...args) => { const result = await savePayment(...args); if (result.success) applied = true; return result; };
    const markUpdated: typeof updatePayment = async (...args) => { const result = await updatePayment(...args); if (result.success) applied = true; return result; };
    const result = await registerPayment(input, context, { transaction: paymentTransaction, findOrderForUpdate,
      savePayment: markSaved, updatePayment: markUpdated, saveCompletion, deductProductStock, saveStockDeduction, clock: () => new Date() });
    if (result.success) {
      if (applied) log.info({ event: "payment_confirmed", paymentId: input.paymentId, actorKind: "seller", userId: context.userId,
        source: input.source ?? "manual", stockOutcome: result.data.stock.kind, transactionOutcome: "committed" }, "payment_confirmed");
      else log.debug({ event: "payment_operation_replayed", operation: "confirm", paymentId: input.paymentId }, "payment_operation_replayed");
    } else if (result.error.code === "INSUFFICIENT_STOCK") log.warn({ event: "payment_confirmation_stock_rejected", paymentId: input.paymentId,
      variantId: "variantId" in result.error ? result.error.variantId : undefined,
      errorCode: result.error.code, transactionOutcome: "rolled_back" }, "payment_confirmation_stock_rejected");
    else if (result.error.code === "PAYMENT_CONFLICT") log.debug({ event: "payment_operation_conflict", operation: "confirm",
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
  deductStock: (id: Parameters<typeof deductStock>[0], context: Parameters<typeof deductStock>[1]) =>
    deductStock(id, context, { transaction: stockTransaction, findOrderForUpdate, deductProductStock, saveStockDeduction }),
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: pendingTransaction, orderExists,
      findVariant: findSellableVariant, saveOrder: savePendingOrder, allocateNumber: allocateOrderNumber,
      newItemId: () => randomUUID() as OrderItemId, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  searchProducts: searchSaleCatalog,
};

type Persistence = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

// Chats and contacts return plain strings; the brands belong to orders and are applied only here.
const messageOrderDependencies: AddMessageProductsDependencies = {
  findSourceMessage: async (id) => {
    const found = await findOrderSourceMessage(id);
    if (!found.success || !found.data) return found as Result<null, Persistence>;
    const message = found.data;
    return ok({ ...message, companyId: message.companyId as string as CompanyId, chatId: message.chatId as ChatId,
      contactId: message.contactId as ContactId, uploadedByUserId: message.uploadedByUserId as string as UserId, imageId: message.imageId as ImageId | null });
  },
  readImage: (imageId) => readImageBytes(imageId),
  identifyProducts: (image) => products.identifyProductsInImage(image),
  findProcessedMessage,
  transaction: scopedOrderTransaction,
  ensureCustomerForContact: async (contactId) => {
    const ensured = await ensureCustomerForContact(contactId);
    return ensured.success ? ok({ ...ensured.data, customerId: ensured.data.customerId as CustomerId, contactId: ensured.data.contactId as ContactId }) : ensured;
  },
  findOpenChatOrderCandidate,
  findOrderForUpdate: (id) => findOrderForUpdate(id, getCompanyId() as CompanyId),
  allocateNumber: allocateOrderNumber,
  saveNewOrder: (order, source) => savePendingOrder(order, source),
  saveAddedItems,
  recordProcessedMessage,
  newOrderId: () => randomUUID() as OrderId,
  newItemId: () => randomUUID() as OrderItemId,
  clock: () => new Date(),
};

export { messageOrderPolicy, findOrderedVariantIds };
const retryableCodes: readonly AddMessageProductsError["code"][] = ["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "QR_READER_UNAVAILABLE",
  "EMBEDDER_UNAVAILABLE", "PRODUCT_MATCHER_UNAVAILABLE"];

const matchFields = (match: MessageProductMatch) => match.method === "qr" ? { matchMethod: match.method, unknownCodes: match.unknownCodes }
  : { matchMethod: match.method, confidence: match.confidence, candidates: match.candidates, topDistance: match.topDistance, chosenDistance: match.chosenDistance };

/** Handler of `message_created`: logs each outcome and tells the bus which failures deserve a retry. */
export const addMessageProductsHandler: EventHandler<AppEvents, "message_created"> = async (payload, metadata, context) => {
  const started = performance.now();
  const base = () => ({ companyId: payload.companyId, messageId: payload.messageId, eventId: metadata.eventId,
    attempt: context.attempt, durationMs: Math.round(performance.now() - started) });
  const result = await withTenantIsolation(payload.companyId, () => addMessageProductsToOrder(
    { companyId: payload.companyId as CompanyId, messageId: payload.messageId as ChatMessageId }, messageOrderDependencies));
  if (result.success) {
    const outcome = result.data;
    if (outcome.kind === "order_created" || outcome.kind === "items_added") log.info({ event: outcome.kind === "order_created" ? "orders_message_order_created" : "orders_message_order_items_added",
      ...base(), orderId: outcome.orderId, variantCount: outcome.variantIds.length, ...matchFields(outcome.match) }, "Message products added to order");
    else log.info({ event: "orders_message_order_skipped", ...base(), ...(outcome.kind === "already_processed" ? { orderId: outcome.orderId, reason: "already_processed" } : { reason: outcome.reason, topDistance: outcome.topDistance, chosenDistance: outcome.chosenDistance }) },
      "Message skipped for orders");
    return ok(undefined);
  }
  const retryable = retryableCodes.includes(result.error.code);
  // A retryable failure is a warning until the last attempt: then the job stays failed.
  log[retryable && context.attempt <= messageOrderPolicy.retries ? "warn" : "error"]({ event: "orders_message_order_failed", ...base(), code: result.error.code, retryable }, "Message order failed");
  return err({ code: result.error.code, message: result.error.message, retryable });
};
