import { log } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, requireNoActiveTransaction, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { setOrderDelivery, type SetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { resolveDeliverySelection, type ResolveDeliveryDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";
import { validateDeliveryCost, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { createOrder, type CreateOrderDependencies } from "@core/src/features/orders/application/create-order";
import { deductStock, type DeductStockDependencies } from "@core/src/features/orders/application/deduct-stock";
import { registerPayment, type RegisterPaymentDependencies } from "@core/src/features/orders/application/register-payment";
import { registerImmediateSale, type RegisterImmediateSaleDependencies } from "@core/src/features/orders/application/register-immediate-sale";
import { cancelOrder, type CancelOrderDependencies } from "@core/src/features/orders/application/cancel-order";
import { registerShipment, registerDelivery, type FulfillOrderDependencies } from "@core/src/features/orders/application/fulfill-order";
import { getOrderAggregate } from "@core/src/features/orders/application/read-order-aggregate";
import { listOrderAggregates } from "@core/src/features/orders/application/list-order-aggregates";
import { listOrders } from "@core/src/features/orders/application/read-orders";
import { savePendingOrder, savePayment, saveDelivery, saveStockDeduction, saveFulfillment, saveCancellation, findOrderAggregate, findOrderAggregates, findOrderForUpdate, findOrders, orderExists } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, deductProductStock, restoreProductStock, searchSaleCatalog } from "@core/src/features/products";
import { findContactById, searchSaleContacts } from "@core/src/features/contacts";
import type { OrderItemId, PaymentId } from "@core/src/features/orders/domain/order";

async function orderTransaction<T, E extends AppError>(callback: () => Promise<Result<T, E>>, deliveryContext?: Readonly<{ orderId: string; userId: string }>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  try {
    return await withinTransaction(callback);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_complete_order_transaction", ...(deliveryContext ? { operation: "set_order_delivery",
      orderId: deliveryContext.orderId, userId: deliveryContext.userId, transactionOutcome: "unknown", errorCode: "PERSISTENCE_UNAVAILABLE" } : {}), err: cause }, "unable_to_complete_order_transaction");
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

export const orders = {
  setDelivery: (input: SetDeliveryInput, context: OrderAccess) => setConfiguredOrderDelivery(input, context),
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
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder,
      savePayment, deductProductStock, saveStockDeduction, saveFulfillment,
      newItemId: () => randomUUID() as OrderItemId, newPaymentId: () => randomUUID() as PaymentId, clock: () => new Date() }),
  registerPayment: (input: Parameters<typeof registerPayment>[0], context: Parameters<typeof registerPayment>[1]) => {
    requireNoActiveTransaction();
    return registerPayment(input, context, { transaction: paymentTransaction, findOrderForUpdate, savePayment,
      deductProductStock, saveStockDeduction, clock: () => new Date() });
  },
  deductStock: (id: Parameters<typeof deductStock>[0], context: Parameters<typeof deductStock>[1]) =>
    deductStock(id, context, { transaction: stockTransaction, findOrderForUpdate, deductProductStock, saveStockDeduction }),
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: pendingTransaction, orderExists,
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder,
      newItemId: () => randomUUID() as OrderItemId, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  searchProducts: searchSaleCatalog,
  searchContacts: searchSaleContacts,
  contactById: findContactById,
};
