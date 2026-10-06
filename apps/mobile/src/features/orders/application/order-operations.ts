import { z } from "zod";
import { listOrderAggregatesResponseSchema, listOrderAggregatesSchema, listOrdersResponseSchema, listOrdersSchema, orderCatalogSchema, orderContactsSchema,
  type SetOrderDeliveryRequest, type CreateOrderRequest, type ListOrderAggregatesRequest, type ListOrdersRequest, type OrderAggregateResponse, type OrderApiError, type OrderApiIssue } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import { limaMidnightUtc, nextCalendarDay } from "@shared/orders-date";
import type { Result } from "@shared/result";
import { prepareOrder, type CartError, type OrderDraft } from "@mobile/features/orders/domain/order-draft";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type PendingOrderConfirmation = Readonly<{
  companyId: OrderAggregateResponse["companyId"];
  id: CreateOrderRequest["id"];
  shownTotal: Money;
}>;
export type PendingOrderStoreError = Readonly<{
  code: "PENDING_CONFIRMATION" | "PENDING_STORAGE_UNAVAILABLE" | "INVALID_PENDING_DATA";
  message: string;
}>;
export type OrderRequestError = Readonly<{
  code: TransportError["code"] | OrderApiError["code"];
  message: string;
  issues?: readonly OrderApiIssue[];
}>;
export type ConfirmOrderError = OrderRequestError | PendingOrderStoreError | CartError;
export type ConfirmOrderOutcome =
  | Readonly<{ kind: "completed"; order: OrderAggregateResponse; shownTotal: Money }>
  | Readonly<{ kind: "uncertain"; pending: PendingOrderConfirmation }>;

export type OrderListCriteria = Readonly<{
  page: number;
  customer: { kind: "all" } | { kind: "general_public" } | { kind: "contact"; contactId: string };
  fromDay?: string;
  throughDay?: string;
}>;

type Api = Readonly<{
  setDelivery: (orderId: string, input: SetOrderDeliveryRequest) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  enableCheckout: (orderId: string) => Promise<Result<Readonly<{ url: string }>, OrderRequestError>>;
  listAggregates: (input: ListOrderAggregatesRequest) => Promise<Result<z.infer<typeof listOrderAggregatesResponseSchema>, OrderRequestError>>;
  getAggregate: (id: string) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  list: (input: ListOrdersRequest) => Promise<Result<z.infer<typeof listOrdersResponseSchema>, OrderRequestError>>;
  get: (id: string) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  create: (input: CreateOrderRequest) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  searchCatalog: (search: string) => Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>>;
  searchContacts: (search: string) => Promise<Result<z.infer<typeof orderContactsSchema>, OrderRequestError>>;
}>;
type PendingStore = Readonly<{
  read: (companyId: string) => Promise<Result<PendingOrderConfirmation | null, PendingOrderStoreError>>;
  save: (pending: PendingOrderConfirmation) => Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>>;
  clear: (companyId: string, id: string) => Promise<Result<void, PendingOrderStoreError>>;
}>;

function listRequest(criteria: OrderListCriteria): Result<ListOrdersRequest, OrderRequestError> {
  if ((criteria.fromDay && !z.iso.date().safeParse(criteria.fromDay).success) ||
      (criteria.throughDay && !z.iso.date().safeParse(criteria.throughDay).success) ||
      (criteria.fromDay && criteria.throughDay && criteria.fromDay > criteria.throughDay))
    return err({ code: "INVALID_INPUT", message: "Invalid order days" });
  const parsed = listOrdersSchema.safeParse({ page: criteria.page, customer: criteria.customer.kind,
    ...(criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    ...(criteria.fromDay ? { completedFrom: limaMidnightUtc(criteria.fromDay) } : {}),
    ...(criteria.throughDay ? { completedBefore: limaMidnightUtc(nextCalendarDay(criteria.throughDay)) } : {}),
  });
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_INPUT", message: "Invalid order filters" });
}

function mixedListRequest(criteria: OrderListCriteria): Result<ListOrderAggregatesRequest, OrderRequestError> {
  if ((criteria.fromDay && !z.iso.date().safeParse(criteria.fromDay).success) ||
      (criteria.throughDay && !z.iso.date().safeParse(criteria.throughDay).success) ||
      (criteria.fromDay && criteria.throughDay && criteria.fromDay > criteria.throughDay))
    return err({ code: "INVALID_INPUT", message: "Invalid order days" });
  const parsed = listOrderAggregatesSchema.safeParse({ page: criteria.page, customer: criteria.customer.kind,
    ...(criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    ...(criteria.fromDay ? { createdFrom: limaMidnightUtc(criteria.fromDay) } : {}),
    ...(criteria.throughDay ? { createdBefore: limaMidnightUtc(nextCalendarDay(criteria.throughDay)) } : {}),
  });
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_INPUT", message: "Invalid order filters" });
}

const definitive = new Set<OrderRequestError["code"]>(["INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE",
  "INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND", "VARIANT_NOT_FOUND", "INSUFFICIENT_STOCK"]);
const completedImmediateSale = (order: OrderAggregateResponse) => order.status === "completed" &&
  order.paymentStatus === "paid" && order.balanceDue.amount === 0 &&
  order.paidAmount.currency === order.total.currency && order.paidAmount.amount >= order.total.amount &&
  order.deliveryStatus === "delivered" && order.stockDeducted && order.delivery === null;

export function createOrderOperations(api: Api, pendingStore: PendingStore) {
  let inFlight: Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> | null = null;
  const resolvePendingOrderConfirmation = async (companyId: string): Promise<Result<ConfirmOrderOutcome | null, ConfirmOrderError>> => {
    const pending = await pendingStore.read(companyId);
    if (!pending.success) return pending;
    if (!pending.data) return ok(null);
    const found = await api.get(pending.data.id);
    if (!found.success) return found.error.code === "ORDER_NOT_FOUND"
      ? ok({ kind: "uncertain", pending: pending.data }) : found;
    if (found.data.companyId !== companyId || found.data.id !== pending.data.id)
      return err({ code: "INVALID_RESPONSE", message: "Order identity mismatch" });
    return completedImmediateSale(found.data)
      ? ok({ kind: "completed", order: found.data, shownTotal: pending.data.shownTotal })
      : err({ code: "INVALID_RESPONSE", message: "Order is not a completed immediate sale" });
  };
  const send = async (draft: OrderDraft, companyId: string): Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> => {
    const prepared = prepareOrder(draft);
    if (!prepared.success) return prepared;
    const current = await pendingStore.read(companyId);
    if (!current.success) return current;
    if (current.data && current.data.id !== prepared.data.request.id)
      return err({ code: "PENDING_CONFIRMATION", message: "Another order needs verification" });
    const saved = await pendingStore.save({ companyId, id: prepared.data.request.id, shownTotal: prepared.data.shownTotal });
    if (!saved.success) return saved;
    const request: CreateOrderRequest = { ...prepared.data.request,
      payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
    const result = await api.create(request);
    if (result.success) {
      if (result.data.companyId !== companyId || result.data.id !== saved.data.id)
        return err({ code: "INVALID_RESPONSE", message: "Order identity mismatch" });
      return completedImmediateSale(result.data)
        ? ok({ kind: "completed", order: result.data, shownTotal: saved.data.shownTotal })
        : err({ code: "INVALID_RESPONSE", message: "Order is not a completed immediate sale" });
    }
    if (definitive.has(result.error.code)) {
      const cleared = await pendingStore.clear(companyId, saved.data.id);
      return cleared.success ? result : cleared;
    }
    const found = await api.get(saved.data.id);
    if (found.success) {
      if (found.data.companyId !== companyId || found.data.id !== saved.data.id)
        return err({ code: "INVALID_RESPONSE", message: "Order identity mismatch" });
      if (completedImmediateSale(found.data))
        return ok({ kind: "completed", order: found.data, shownTotal: saved.data.shownTotal });
    }
    return ok({ kind: "uncertain", pending: saved.data });
  };
  return {
    setDelivery: api.setDelivery,
    loadMixedOrders: async (criteria: OrderListCriteria) => {
      const input = mixedListRequest(criteria);
      return input.success ? api.listAggregates(input.data) : input;
    },
    loadOrderAggregate: api.getAggregate,
    enableOrderCheckout: api.enableCheckout,
    loadOrders: async (criteria: OrderListCriteria) => {
      const input = listRequest(criteria);
      return input.success ? api.list(input.data) : input;
    },
    loadOrder: api.get,
    searchOrderCatalog: api.searchCatalog,
    searchOrderContacts: api.searchContacts,
    readPendingOrderConfirmation: pendingStore.read,
    resolvePendingOrderConfirmation,
    clearPendingOrderConfirmation: pendingStore.clear,
    completeOrder: (draft: OrderDraft, companyId: string): Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> => {
      if (inFlight) return inFlight;
      inFlight = send(draft, companyId).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
