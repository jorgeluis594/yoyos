import { z } from "zod";
import { listOrderAggregatesResponseSchema, listOrderAggregatesSchema, listOrdersResponseSchema, listOrdersSchema, orderCatalogSchema, orderContactsSchema,
  type LegacyCompleteOrderRequest, type ListOrderAggregatesRequest, type ListOrdersRequest, type OrderAggregateResponse, type OrderApiError, type OrderApiIssue } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import { add, subtract, type Money } from "@shared/money";
import { limaMidnightUtc, nextCalendarDay } from "@shared/orders-date";
import type { Result } from "@shared/result";
import { prepareOrder, ratedDeliveryAssignmentSchema, type CartError, type OrderDraft, type OrderSubmission, type RatedDeliveryAssignment } from "@mobile/features/orders/domain/order-draft";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type PendingOrderConfirmation = Readonly<{
  companyId: OrderAggregateResponse["companyId"];
  id: string;
  shownTotal: Money;
}> & ({ version?: never; request?: never } | { version: 2; request: OrderSubmission | LegacyCompleteOrderRequest });
export type PendingOrderStoreError = Readonly<{
  code: "PENDING_CONFIRMATION" | "PENDING_STORAGE_UNAVAILABLE" | "INVALID_PENDING_DATA";
  message: string;
}>;
export type OrderRequestError = Readonly<{
  code: TransportError["code"] | OrderApiError["code"];
  message: string;
  issues?: readonly OrderApiIssue[];
  currentPrice?: Money;
}>;
export type ConfirmOrderError = OrderRequestError | PendingOrderStoreError | CartError;
export type ConfirmOrderOutcome =
  | Readonly<{ kind: "completed"; order: OrderAggregateResponse; shownTotal: Money }>
  | Readonly<{ kind: "uncertain"; pending: PendingOrderConfirmation }>;

export type OrderListCriteria = Readonly<{
  page: number;
  customer: { kind: "all" } | { kind: "general_public" } | { kind: "contact"; contactId: string };
  search?: string;
  view?: "all" | "unpaid" | "undelivered";
  fromDay?: string;
  throughDay?: string;
}>;

export type { RatedDeliveryAssignment } from "@mobile/features/orders/domain/order-draft";

type Api = Readonly<{
  setDelivery: (orderId: string, input: RatedDeliveryAssignment) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  enableCheckout: (orderId: string) => Promise<Result<Readonly<{ url: string }>, OrderRequestError>>;
  listAggregates: (input: ListOrderAggregatesRequest) => Promise<Result<z.infer<typeof listOrderAggregatesResponseSchema>, OrderRequestError>>;
  getAggregate: (id: string) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  list: (input: ListOrdersRequest) => Promise<Result<z.infer<typeof listOrdersResponseSchema>, OrderRequestError>>;
  get: (id: string) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  create: (input: OrderSubmission) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  searchCatalog: (search: string) => Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>>;
  searchContacts: (search: string) => Promise<Result<z.infer<typeof orderContactsSchema>, OrderRequestError>>;
}>;
type PendingStore = Readonly<{
  read: (companyId: string) => Promise<Result<PendingOrderConfirmation | null, PendingOrderStoreError>>;
  save: (pending: PendingOrderConfirmation) => Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>>;
  clear: (companyId: string, id: string) => Promise<Result<void, PendingOrderStoreError>>;
  replace: (previous: PendingOrderConfirmation, next: PendingOrderConfirmation) => Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>>;
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
    ...(criteria.search ? { search: criteria.search.trim() } : {}), ...(criteria.view ? { view: criteria.view } : {}),
    ...(criteria.customer.kind === "contact" ? { contactId: criteria.customer.contactId } : {}),
    ...(criteria.fromDay ? { createdFrom: limaMidnightUtc(criteria.fromDay) } : {}),
    ...(criteria.throughDay ? { createdBefore: limaMidnightUtc(nextCalendarDay(criteria.throughDay)) } : {}),
  });
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_INPUT", message: "Invalid order filters" });
}

const definitive = new Set<OrderRequestError["code"]>(["INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE",
  "INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND", "VARIANT_NOT_FOUND", "INSUFFICIENT_STOCK",
  "INVALID_PAYMENT", "PAYMENT_CONFLICT", "PAYMENT_REQUIRED", "INVALID_TRANSITION", "STOCK_NOT_DEDUCTED",
  "DELIVERY_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "COURIER_UNAVAILABLE", "RATE_UNAVAILABLE", "TOTAL_CHANGED", "INVALID_DISTRICT", "INVALID_DELIVERY_RATE"]);
export function createOrderOperations(api: Api, pendingStore: PendingStore) {
  const inFlight = new Map<string, { id?: string; promise: Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> }>();
  const confirmed = (order: OrderAggregateResponse, pending: PendingOrderConfirmation): Result<ConfirmOrderOutcome, ConfirmOrderError> => {
    if (order.companyId !== pending.companyId || order.id !== pending.id ||
      (order.status === "completed" && (order.paymentStatus !== "paid" || order.balanceDue.amount !== 0 || order.deliveryStatus !== "delivered" || !order.stockDeducted)))
      return err({ code: "INVALID_RESPONSE", message: "Order identity or state mismatch" });
    return ok({ kind: "completed", order, shownTotal: pending.shownTotal });
  };
  const resolvePendingOrderConfirmation = async (companyId: string): Promise<Result<ConfirmOrderOutcome | null, ConfirmOrderError>> => {
    const pending = await pendingStore.read(companyId);
    if (!pending.success) return pending;
    if (!pending.data) return ok(null);
    const found = await api.get(pending.data.id);
    if (!found.success) return found.error.code === "ORDER_NOT_FOUND"
      ? ok({ kind: "uncertain", pending: pending.data }) : found;
    return confirmed(found.data, pending.data);
  };
  const post = async (pending: PendingOrderConfirmation, retainDeliveryConflict = false): Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> => {
    if (!pending.request) return err({ code: "PENDING_CONFIRMATION", message: "Legacy attempt can only be verified; original request is unavailable" });
    const { delivery, ...selection } = pending.request;
    if (delivery && "chargeDeliveryToCustomer" in delivery)
      return err({ code: "INVALID_INPUT", message: "Legacy delivery requires review of a current rate" });
    const request: OrderSubmission = delivery ? { ...selection, delivery } : selection;
    const result = await api.create(request);
    if (result.success) return confirmed(result.data, pending);
    if (retainDeliveryConflict && delivery && ["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DELIVERY_RATE", "INVALID_DISTRICT",
      "COURIER_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "DELIVERY_UNAVAILABLE"].includes(result.error.code)) return result;
    if (definitive.has(result.error.code)) {
      const cleared = await pendingStore.clear(pending.companyId, pending.id);
      return cleared.success ? result : cleared;
    }
    const found = await api.get(pending.id);
    return found.success ? confirmed(found.data, pending) : ok({ kind: "uncertain", pending });
  };
  const retry = async (pending: PendingOrderConfirmation): Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> => {
    const found = await api.get(pending.id);
    if (found.success) return confirmed(found.data, pending);
    if (found.error.code !== "ORDER_NOT_FOUND") return found;
    return post(pending, true);
  };
  const send = async (draft: OrderDraft, companyId: string): Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>> => {
    const current = await pendingStore.read(companyId);
    if (!current.success) return current;
    if (current.data) {
      if (draft.kind !== "items" || current.data.id !== draft.id)
        return err({ code: "PENDING_CONFIRMATION", message: "Another order needs verification" });
      return retry(current.data);
    }
    const prepared = prepareOrder(draft);
    if (!prepared.success) return prepared;
    const saved = await pendingStore.save({ version: 2, companyId, id: prepared.data.request.id,
      shownTotal: prepared.data.shownTotal, request: prepared.data.request });
    return saved.success ? post(saved.data) : saved;
  };
  const run = (companyId: string, id: string | undefined, work: () => Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>>) => {
    const current = inFlight.get(companyId);
    if (current) return current.id === id ? current.promise : Promise.resolve(err({ code: "PENDING_CONFIRMATION" as const, message: "Another order needs verification" }));
    const promise = work().finally(() => { inFlight.delete(companyId); });
    inFlight.set(companyId, { id, promise });
    return promise;
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
    completeOrder: (draft: OrderDraft, companyId: string) => run(companyId, draft.kind === "items" ? draft.id : undefined, () => send(draft, companyId)),
    reviewLegacyPendingDelivery: (companyId: string, delivery: RatedDeliveryAssignment) => run(companyId, undefined, async () => {
      const pending = await pendingStore.read(companyId);
      if (!pending.success) return pending;
      if (!pending.data?.request?.delivery)
        return err({ code: "PENDING_CONFIRMATION", message: "No delivery attempt to review" });
      const found = await api.get(pending.data.id);
      if (found.success) return confirmed(found.data, pending.data);
      if (found.error.code !== "ORDER_NOT_FOUND") return found;
      const parsed = ratedDeliveryAssignmentSchema.safeParse(delivery);
      if (!parsed.success) return err({ code: "INVALID_CART", message: "Invalid reviewed delivery" });
      const previous = pending.data.request.delivery;
      const products = "expectedPrice" in previous ? subtract(previous.expectedPrice)(pending.data.shownTotal) : ok(pending.data.shownTotal);
      if (!products.success || products.data.amount <= 0) return err({ code: "INVALID_CART", message: "Invalid saved product total" });
      const total = add(parsed.data.expectedPrice)(products.data);
      if (!total.success) return err({ code: "INVALID_CART", message: "Invalid reviewed total" });
      const next = { ...pending.data, shownTotal: total.data, request: { ...pending.data.request, delivery: parsed.data } };
      const saved = await pendingStore.replace(pending.data, next);
      return saved.success ? ok({ kind: "uncertain", pending: saved.data }) : saved;
    }),
    resendPendingOrder: (companyId: string) => run(companyId, undefined, async () => {
      const pending = await pendingStore.read(companyId);
      if (!pending.success) return pending;
      return pending.data ? retry(pending.data) : err({ code: "PENDING_CONFIRMATION", message: "No pending attempt to resend" });
    }),
  };
}
