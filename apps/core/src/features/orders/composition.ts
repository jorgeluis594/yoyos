import { enableOrderCheckout, getOrderCheckout, confirmOrderCheckout, type CheckoutDependencies, type ConfirmOrderCheckoutInput } from "@core/src/features/orders/application/checkout";
import { findCheckoutOrder, findCheckoutOrderForUpdate, saveCheckoutEnabled, saveCheckoutBuyer, saveCheckoutConfirmed } from "@core/src/features/orders/infrastructure/checkout-repository";
import type { CheckoutAccess, CheckoutError } from "@core/src/features/orders/domain/checkout";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, requireNoActiveTransaction, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { setOrderDelivery, type SetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { resolveDeliverySelection, type ResolveDeliveryDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";
import { validateDeliveryCost, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { z } from "zod";
import { createOrder, type CreateOrderDependencies } from "@core/src/features/orders/application/create-order";
import { deductStock, type DeductStockDependencies } from "@core/src/features/orders/application/deduct-stock";
import { registerPayment, type RegisterPaymentDependencies } from "@core/src/features/orders/application/register-payment";
import { reportPayment, type ReportPaymentDependencies } from "@core/src/features/orders/application/report-payment";
import { voidPayment, type VoidPaymentDependencies } from "@core/src/features/orders/application/void-payment";
import { registerImmediateSale, type RegisterImmediateSaleDependencies } from "@core/src/features/orders/application/register-immediate-sale";
import { cancelOrder, type CancelOrderDependencies } from "@core/src/features/orders/application/cancel-order";
import { registerShipment, registerDelivery, type FulfillOrderDependencies } from "@core/src/features/orders/application/fulfill-order";
import { getOrderAggregate } from "@core/src/features/orders/application/read-order-aggregate";
import { listOrderAggregates } from "@core/src/features/orders/application/list-order-aggregates";
import { listOrders } from "@core/src/features/orders/application/read-orders";
import { allocateOrderNumber, savePendingOrder, saveDelivery, savePayment, updatePayment, saveCompletion, saveStockDeduction, saveFulfillment, saveCancellation, findOrderAggregate, findOrderAggregates, findOrderForUpdate, findOrders, orderExists, resolveBuyerOrderCompany } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, deductProductStock, restoreProductStock, searchSaleCatalog } from "@core/src/features/products";
import { findContactById, searchSaleContacts } from "@core/src/features/contacts";
import { findAvailablePublicImage, resolvePublicImage } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import { orderStateMachine } from "@core/src/features/orders/domain/order-state-machine";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CompanyId, OrderId, OrderItemId, PaymentId } from "@core/src/features/orders/domain/order";

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

function scopedOrderTransaction<T, E extends AppError>(companyId: string, callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  return orderTransaction(callback);
}
const pendingTransaction: CreateOrderDependencies["transaction"] = scopedOrderTransaction;
const stockTransaction: DeductStockDependencies["transaction"] = scopedOrderTransaction;
const paymentTransaction: RegisterPaymentDependencies["transaction"] = scopedOrderTransaction;
const reportTransaction: ReportPaymentDependencies["transaction"] = scopedOrderTransaction;
const voidTransaction: VoidPaymentDependencies["transaction"] = scopedOrderTransaction;
const immediateTransaction: RegisterImmediateSaleDependencies["transaction"] = scopedOrderTransaction;
const cancellationTransaction: CancelOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentTransaction: FulfillOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentDependencies: FulfillOrderDependencies = { transaction: fulfillmentTransaction, findOrderForUpdate,
  saveFulfillment, clock: () => new Date() };

export async function setConfiguredOrderDelivery(input: SetDeliveryInput, context: OrderAccess,
  resolveCost: ResolveDeliveryDependencies["resolveCost"] = async () => err({ code: "DELIVERY_UNAVAILABLE", reason: "resolver_not_integrated", message: "Delivery cost resolver is not integrated" })) {
  const started = performance.now();
  const observed: { previous: OrderAggregate | null; settingsVersion?: number; courierId?: string; stage: string } = { previous: null, stage: "lock_order" };
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
    resolveDelivery: (selection, access, currency) => {
      observed.stage = "resolve_delivery";
      if (selection.method === "agency") observed.courierId = selection.courierId;
      return resolveDeliverySelection(selection, access, currency, {
        getSettings: async (authorized) => {
          const settings = await deliverySettings.get(authorized, "set_order_delivery");
          if (settings.success) observed.settingsVersion = settings.data.version;
          return settings;
        },
        resolveCost: async (snapshot, authorized, orderCurrency) => {
          try {
            const resolved = await resolveCost(snapshot, authorized, orderCurrency);
            if (resolved.success) {
              const valid = validateDeliveryCost(resolved.data, orderCurrency);
              if (!valid.success) log.error({ event: "order_delivery_resolution_invalid", operation: "set_order_delivery", orderId: input.orderId,
                courierId: observed.courierId, deliveryMethod: selection.method, stage: observed.stage, reason: valid.error.code === "CURRENCY_MISMATCH" ? "currency_mismatch" : "invalid_cost", errorCode: valid.error.code }, "Delivery cost resolution is invalid");
            }
            return resolved;
          } catch (cause) {
            log.error({ event: "order_delivery_resolution_failed", operation: "set_order_delivery", orderId: input.orderId,
              courierId: observed.courierId, deliveryMethod: selection.method, settingsVersion: observed.settingsVersion, stage: observed.stage, errorCode: "DELIVERY_UNAVAILABLE", err: cause }, "Unable to resolve delivery cost");
            return err({ code: "DELIVERY_UNAVAILABLE", message: "Unable to resolve delivery cost" });
          }
        },
      });
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
      courierId: observed.courierId, previousDeliveryMethod: before?.delivery?.method, deliveryMethod: input.delivery.method, settingsVersion: observed.settingsVersion,
      chargeDeliveryToCustomer: input.chargeDeliveryToCustomer, totalChanged: before?.total.amount !== result.data.total.amount,
      stockDeductionRequired: !before?.stockDeducted && result.data.stockDeducted, stockDeducted: result.data.stockDeducted,
      transactionOutcome: "committed", durationMs }, "Order delivery saved"));
  } else if (!["ORDER_NOT_FOUND", "PERSISTENCE_UNAVAILABLE", "INVALID_STORED_DATA", "INVALID_ORDER", "CURRENCY_MISMATCH"].includes(result.error.code)) {
    log.debug({ event: "order_delivery_rejected", operation: "set_order_delivery", orderId: input.orderId, userId: context.userId,
      courierId: observed.courierId, deliveryMethod: input.delivery.method, settingsVersion: observed.settingsVersion, deliveryStatus: observed.previous?.deliveryStatus, cancelled: observed.previous?.cancelled,
      errorCode: result.error.code, stage: observed.stage,
      ...(result.error.code === "DELIVERY_UNAVAILABLE" ? { reason: result.error.reason } : {}),
      ...(result.error.code === "INSUFFICIENT_STOCK" ? { variantId: result.error.variantId } : {}) }, "Order delivery rejected");
  }
  return result;
}

const checkoutDependencies: CheckoutDependencies = { transaction: scopedOrderTransaction,
  findOrder: findCheckoutOrder, findOrderForUpdate: findCheckoutOrderForUpdate,
  saveEnabled: saveCheckoutEnabled, saveBuyer: saveCheckoutBuyer, saveConfirmed: saveCheckoutConfirmed };
function rejectedCheckout(error: CheckoutError) {
  const outcomes = { CHECKOUT_UNAVAILABLE: "unavailable", ORDER_CANCELLED: "cancelled", INVALID_BUYER: "invalid_input",
    TOTAL_CHANGED: "total_changed", INVALID_CHECKOUT: "technical_failure", PERSISTENCE_UNAVAILABLE: "technical_failure" } as const;
  bindRequestOperation({ outcome: outcomes[error.code] });
}

export async function resolveBuyerAccess(id: string) {
  if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_ORDER" as const, message: "Invalid order ID" });
  const resolved = await resolveBuyerOrderCompany(id as OrderId);
  return resolved.success ? resolved.data ? { success: true as const, data: { kind: "buyer" as const,
    companyId: resolved.data as CompanyId, orderId: id as OrderId } }
    : err({ code: "ORDER_NOT_FOUND" as const, message: "Order not found" }) : resolved;
}

export async function getBuyerPaymentView(id: string) {
  const access = await resolveBuyerAccess(id);
  if (!access.success) return access;
  return withTenantIsolation(access.data.companyId, async () => {
    const [found, settings] = await Promise.all([
      findOrderAggregate(access.data.orderId, access.data.companyId), companyPaymentSettings.get(access.data.companyId),
    ]);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND" as const, message: "Order not found" });
    if (!settings.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Payment settings unavailable" });
    const summary = orderStateMachine.getPaymentSummary(found.data);
    if (!summary.success) return summary;
    const imageIds = [...settings.data.map((item) => item.imageId), ...found.data.payments.map((payment) =>
      payment.status === "reported" ? payment.data.receiptImageId : payment.data.evidence.kind === "buyer_report"
        ? payment.data.evidence.report.receiptImageId : null)].filter((value): value is NonNullable<typeof value> => value !== null);
    const images = new Map<string, string | null>();
    for (const imageId of new Set(imageIds)) {
      const resolved = await resolvePublicImage(imageId);
      if (!resolved.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Image unavailable" });
      images.set(imageId, resolved.data?.url ?? null);
    }
    const view: BuyerPaymentView = { orderId: found.data.id, total: found.data.total, deliveryCharge: found.data.deliveryCharge,
      paidAmount: summary.data.paidAmount, balanceDue: summary.data.balanceDue, paymentStatus: summary.data.status,
      settings: settings.data.map((item) => { const imageUrl = item.imageId ? images.get(item.imageId) ?? null : null;
        return item.method === "digital_wallet" ? { method: item.method, provider: item.provider, holder: item.holder, imageUrl }
          : { method: item.method, bank: item.bank, holder: item.holder, accountNumber: item.accountNumber, cci: item.cci, imageUrl }; }),
      payments: found.data.payments.map((payment) => { const imageId = payment.status === "reported" ? payment.data.receiptImageId
        : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
      return { id: payment.id, status: payment.status, amount: payment.amount, method: payment.method,
        receiptImageUrl: imageId ? images.get(imageId) ?? null : null }; }) };
    return { success: true as const, data: view };
  });
}

export const orders = {
  setDelivery: (input: SetDeliveryInput, context: OrderAccess) => setConfiguredOrderDelivery(input, context),
  resolveBuyerAccess,
  getBuyerPaymentView,
  enableCheckout: async (orderId: OrderId, access: OrderAccess) => {
    requireNoActiveTransaction();
    bindRequestOperation({ operation: "enable_checkout" });
    const result = await enableOrderCheckout(orderId, access, new Date(), checkoutDependencies);
    if (!result.success) { rejectedCheckout(result.error); return result; }
    bindRequestOperation({ outcome: result.data.changed ? "enabled" : "already_enabled", orderNumber: result.data.number });
    if (result.data.changed) log.info({ event: "order_checkout_enabled", companyId: access.companyId, orderNumber: result.data.number, userId: access.userId }, "Order checkout enabled");
    return ok({ url: new URL(`/checkout/${access.companyId}/${orderId}`, process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString() });
  },
  getCheckout: async (access: CheckoutAccess) => {
    bindRequestOperation({ operation: "get_checkout" });
    const result = await withTenantIsolation(access.companyId, () => getOrderCheckout(access, checkoutDependencies));
    if (!result.success) rejectedCheckout(result.error);
    else bindRequestOperation({ outcome: result.data.state.kind, orderNumber: result.data.number });
    return result;
  },
  confirmCheckout: async (input: ConfirmOrderCheckoutInput, access: CheckoutAccess) => {
    requireNoActiveTransaction();
    bindRequestOperation({ operation: "confirm_checkout" });
    const result = await withTenantIsolation(access.companyId, () => confirmOrderCheckout(input, access, new Date(), checkoutDependencies));
    if (!result.success) { rejectedCheckout(result.error); return result; }
    bindRequestOperation({ outcome: result.data.changed ? "confirmed" : "already_confirmed", orderNumber: result.data.checkout.number });
    if (result.data.changed) log.info({ event: "order_checkout_confirmed", companyId: access.companyId, orderNumber: result.data.checkout.number }, "Order checkout confirmed");
    return ok(result.data.checkout);
  },
  listAggregates: (criteria: Parameters<typeof listOrderAggregates>[0], context: Parameters<typeof listOrderAggregates>[1]) =>
    listOrderAggregates(criteria, context, findOrderAggregates),
  getAggregate: (id: Parameters<typeof getOrderAggregate>[0], context: Parameters<typeof getOrderAggregate>[1]) =>
    getOrderAggregate(id, context, findOrderAggregate),
  ship: (id: Parameters<typeof registerShipment>[0], context: Parameters<typeof registerShipment>[1]) =>
    registerShipment(id, context, fulfillmentDependencies),
  deliver: (id: Parameters<typeof registerDelivery>[0], context: Parameters<typeof registerDelivery>[1]) =>
    registerDelivery(id, context, fulfillmentDependencies),
  cancel: (id: Parameters<typeof cancelOrder>[0], context: Parameters<typeof cancelOrder>[1]) =>
    cancelOrder(id, context, { transaction: cancellationTransaction, findOrderForUpdate, restoreProductStock, saveCancellation }),
  registerImmediateSale: (input: Parameters<typeof registerImmediateSale>[0], context: Parameters<typeof registerImmediateSale>[1]) =>
    registerImmediateSale(input, context, { transaction: immediateTransaction, orderExists,
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder, allocateNumber: allocateOrderNumber,
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
  deductStock: (id: Parameters<typeof deductStock>[0], context: Parameters<typeof deductStock>[1]) =>
    deductStock(id, context, { transaction: stockTransaction, findOrderForUpdate, deductProductStock, saveStockDeduction }),
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: pendingTransaction, orderExists,
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder, allocateNumber: allocateOrderNumber,
      newItemId: () => randomUUID() as OrderItemId, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  searchProducts: searchSaleCatalog,
  searchContacts: searchSaleContacts,
  contactById: findContactById,
};
