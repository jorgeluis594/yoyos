import { add, compare, isCurrency, subtract, type Currency, type Money } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { z } from "zod";
import type { CourierId, PickupPoint } from "@core/src/features/delivery-settings";
import { buildOrder, type BuildOrderInput, type BuildOrderError, type CompanyId, type OrderCustomer, type OrderId, type OrderItem, type PaymentId, type UserId } from "@core/src/features/orders/domain/order";

export type OrderStatus = "active" | "cancelled" | "completed";
export type PaymentStatus = "pending" | "paid";
export type DeliveryStatus = "pending" | "shipped" | "delivered";
export type PaymentMethod = "digital_wallet";
export type DocumentType = "national_id" | "passport" | "foreign_id";
export type Recipient = Readonly<{ name: string; phone: string; identity: { kind: "absent" } | { kind: "document"; documentType: DocumentType; document: string } }>;
export type AgencyRecipient = Readonly<Omit<Recipient, "identity"> & { identity: Extract<Recipient["identity"], { kind: "document" }> }>;
export type { CourierId, PickupPoint } from "@core/src/features/delivery-settings";
export type HomeDestination = Readonly<{ address: string; district: string; instructions: string | null }>;
export type DeliveryAuthor = Readonly<{ kind: "seller"; userId: UserId }> | Readonly<{ kind: "buyer" }>;
export type DeliverySelection =
  | Readonly<{ method: "home"; recipient: Recipient; destination: HomeDestination }>
  | Readonly<{ method: "agency"; recipient: AgencyRecipient; courierId: CourierId; agency: string }>
  | Readonly<{ method: "store"; recipient: Recipient }>;
export type DeliverySnapshot = Readonly<{ recordedBy: DeliveryAuthor }> & (
  | Readonly<{ method: "home"; recipient: Recipient; destination: HomeDestination }>
  | Readonly<{ method: "agency"; recipient: AgencyRecipient; courier: Readonly<{ id: CourierId; name: string }>; agency: string }>
  | Readonly<{ method: "store"; recipient: Recipient; pickupPoint: PickupPoint }>
);
export type Payment = Readonly<{ id: PaymentId; orderId: OrderId; amount: Money; method: PaymentMethod; recordedAt: Date }>;
export type OrderAggregate = Readonly<{
  id: OrderId;
  companyId: CompanyId;
  sellerId: UserId;
  customer: OrderCustomer;
  createdAt: Date;
  completedAt: Date | null;
  cancelled: boolean;
  items: readonly [OrderItem, ...OrderItem[]];
  payments: readonly Payment[];
  delivery: DeliverySnapshot | null;
  deliveryStatus: DeliveryStatus;
  stockDeducted: boolean;
  itemsTotal: Money;
  deliveryCost: Money;
  deliveryCharge: Money;
  total: Money;
}>;
export type PaymentSummary = Readonly<{ status: PaymentStatus; paidAmount: Money; balanceDue: Money; overpaidAmount: Money }>;
export type OrderLifecycle =
  | Readonly<{ status: "active"; completedAt: null }>
  | Readonly<{ status: "cancelled"; completedAt: null }>
  | Readonly<{ status: "completed"; completedAt: Date }>;
export type OrderDomainError = Readonly<{ code: "INVALID_ORDER" | "INVALID_PAYMENT" | "CURRENCY_MISMATCH" | "PAYMENT_CONFLICT" | "INVALID_TRANSITION" | "DELIVERY_LOCKED" | "PAYMENT_REQUIRED" | "STOCK_NOT_DEDUCTED" | "ORDER_CANCELLED"; message: string }>;
export type ResolvedDelivery = Readonly<{ delivery: DeliverySnapshot; cost: Money }>;
export type SetDeliveryChange = Readonly<{ resolved: ResolvedDelivery; chargeDeliveryToCustomer: boolean }>;
export type StockDeductionPlan =
  | Readonly<{ kind: "none"; reason: "already_deducted" | "not_requested"; nextOrder: OrderAggregate }>
  | Readonly<{ kind: "deduct"; nextOrder: OrderAggregate }>;
export type CancellationPlan = Readonly<{ nextOrder: OrderAggregate; restoreStock: boolean }>;
export type BuildPendingOrderInput = BuildOrderInput;

export function buildPendingOrder(input: BuildPendingOrderInput): Result<OrderAggregate, BuildOrderError> {
  const built = buildOrder(input);
  if (!built.success) return built;
  const snapshot = built.data;
  const zero: Money = { amount: 0, currency: snapshot.total.currency };
  return ok({ id: snapshot.id, companyId: snapshot.companyId, sellerId: snapshot.sellerId,
    customer: snapshot.customer, items: snapshot.items, total: snapshot.total,
    createdAt: new Date(input.createdAt), completedAt: null, cancelled: false,
    payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
    itemsTotal: snapshot.total, deliveryCost: zero, deliveryCharge: zero });
}

const maxCents = 999999999999999n;
const moneyAmount = z.number().finite().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(value.toString()) &&
  BigInt(value.toFixed(2).replace(".", "")) <= maxCents);
const requiredText = z.string().trim().min(1);
const identity = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({ kind: z.literal("document"), documentType: z.enum(["national_id", "passport", "foreign_id"]), document: requiredText }),
]);
const recipient = z.strictObject({ name: requiredText, phone: requiredText, identity });
const documentedRecipient = z.strictObject({ name: requiredText, phone: requiredText,
  identity: z.strictObject({ kind: z.literal("document"), documentType: z.enum(["national_id", "passport", "foreign_id"]), document: requiredText }) });
const homeDestination = z.strictObject({ address: requiredText.max(500), district: requiredText.max(120), instructions: requiredText.max(1000).nullable() });
const pickupPoint = z.strictObject({ name: requiredText.max(120), address: requiredText.max(500), instructions: requiredText.max(1000).nullable() });
const recordedBy = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("seller"), userId: requiredText.transform((value) => value as UserId) }),
  z.strictObject({ kind: z.literal("buyer") }),
]);
const courierId = z.uuid().transform((value) => value as CourierId);
const selection = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient, destination: homeDestination }),
  z.strictObject({ method: z.literal("agency"), recipient: documentedRecipient, courierId, agency: requiredText.max(500) }),
  z.strictObject({ method: z.literal("store"), recipient }),
]);
const delivery = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient, destination: homeDestination, recordedBy }),
  z.strictObject({ method: z.literal("agency"), recipient: documentedRecipient,
    courier: z.strictObject({ id: courierId, name: requiredText.max(120) }), agency: requiredText.max(500), recordedBy }),
  z.strictObject({ method: z.literal("store"), recipient, pickupPoint, recordedBy }),
]);
export function parseDeliverySelection(value: unknown): Result<DeliverySelection, OrderDomainError> {
  const parsed = selection.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_ORDER", message: "Invalid delivery selection" });
}
export function parseDeliverySnapshot(value: unknown): Result<DeliverySnapshot, OrderDomainError> {
  const parsed = delivery.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_ORDER", message: "Invalid delivery snapshot" });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (date: Date) => date instanceof Date && Number.isFinite(date.getTime());
const failure = (code: OrderDomainError["code"], message: string): Result<never, OrderDomainError> => err({ code, message });
const validMoney = (value: Money, positive: boolean) => isCurrency(value?.currency) && moneyAmount.safeParse(value?.amount).success && (!positive || value.amount > 0);

export function validateDeliveryCost(cost: Money, currency: Currency): Result<Money, OrderDomainError> {
  if (!validMoney(cost, false)) return failure("INVALID_ORDER", "Invalid delivery cost");
  return cost.currency === currency ? ok(cost) : failure("CURRENCY_MISMATCH", "Delivery currency differs from order");
}

function paymentSummary(order: OrderAggregate): Result<PaymentSummary, OrderDomainError> {
  if (!uuid.test(order.id) || !uuid.test(order.companyId) || !order.sellerId || !order.items.length ||
    (order.delivery !== null && !delivery.safeParse(order.delivery).success) ||
    !validMoney(order.total, true) || !validMoney(order.itemsTotal, true) || !validMoney(order.deliveryCost, false) || !validMoney(order.deliveryCharge, false) ||
    order.itemsTotal.currency !== order.total.currency || order.deliveryCost.currency !== order.total.currency || order.deliveryCharge.currency !== order.total.currency ||
    (order.delivery === null && (order.deliveryCost.amount !== 0 || order.deliveryCharge.amount !== 0)) ||
    (order.deliveryCharge.amount !== 0 && order.deliveryCharge.amount !== order.deliveryCost.amount)) return failure("INVALID_ORDER", "Invalid order amounts");
  const expectedTotal = add(order.deliveryCharge)(order.itemsTotal);
  if (!expectedTotal.success || expectedTotal.data.amount !== order.total.amount) return failure("INVALID_ORDER", "Invalid order total");
  let paidAmount: Money = { amount: 0, currency: order.total.currency };
  const ids = new Set<string>();
  for (const payment of order.payments) {
    if (!uuid.test(payment.id) || ids.has(payment.id) || payment.orderId !== order.id || payment.method !== "digital_wallet" || !validDate(payment.recordedAt) ||
      !validMoney(payment.amount, true)) return failure("INVALID_PAYMENT", "Invalid recorded payment");
    if (payment.amount.currency !== order.total.currency) return failure("CURRENCY_MISMATCH", "Payment currency differs from order");
    ids.add(payment.id);
    const sum = add(payment.amount)(paidAmount);
    if (!sum.success || !validMoney(sum.data, false)) return failure("INVALID_PAYMENT", "Payments exceed supported range");
    paidAmount = sum.data;
  }
  const coverage = compare(order.total)(paidAmount);
  if (!coverage.success) return failure("INVALID_ORDER", "Invalid payment comparison");
  const zero: Money = { amount: 0, currency: order.total.currency };
  const difference = coverage.data >= 0 ? subtract(order.total)(paidAmount) : subtract(paidAmount)(order.total);
  if (!difference.success) return failure("INVALID_ORDER", "Invalid balance");
  return ok({ status: coverage.data >= 0 ? "paid" : "pending", paidAmount,
    balanceDue: coverage.data < 0 ? difference.data : zero, overpaidAmount: coverage.data > 0 ? difference.data : zero });
}

function lifecycle(order: OrderAggregate): Result<OrderLifecycle, OrderDomainError> {
  const summary = paymentSummary(order);
  if (!summary.success) return summary;
  if (!validDate(order.createdAt) || (order.completedAt !== null && !validDate(order.completedAt)) ||
    (order.deliveryStatus !== "pending" && order.deliveryStatus !== "shipped" && order.deliveryStatus !== "delivered") ||
    ((order.deliveryStatus === "shipped" || order.deliveryStatus === "delivered") && (!order.stockDeducted || summary.data.status !== "paid"))) return failure("INVALID_ORDER", "Invalid order state");
  if (order.cancelled) return order.completedAt === null ? ok({ status: "cancelled", completedAt: null }) : failure("INVALID_ORDER", "Cancelled order has completion date");
  if (order.deliveryStatus === "delivered") return order.completedAt ? ok({ status: "completed", completedAt: order.completedAt }) : failure("INVALID_ORDER", "Completed order lacks date");
  return order.completedAt === null ? ok({ status: "active", completedAt: null }) : failure("INVALID_ORDER", "Active order has completion date");
}

function setDelivery(order: OrderAggregate, change: SetDeliveryChange): Result<OrderAggregate, OrderDomainError> {
  const allowed = canSetDelivery(order);
  if (!allowed.success) return allowed;
  const { cost, delivery: details } = change.resolved;
  if (!delivery.safeParse(details).success || typeof change.chargeDeliveryToCustomer !== "boolean") return failure("INVALID_ORDER", "Invalid delivery");
  const validatedCost = validateDeliveryCost(cost, order.total.currency);
  if (!validatedCost.success) return validatedCost;
  const charge: Money = change.chargeDeliveryToCustomer ? cost : { amount: 0, currency: cost.currency };
  const total = add(charge)(order.itemsTotal);
  if (!total.success || !validMoney(total.data, true)) return failure("INVALID_ORDER", "Total exceeds supported range");
  return ok({ ...order, delivery: details, deliveryCost: cost, deliveryCharge: charge, total: total.data });
}

function canSetDelivery(order: OrderAggregate): Result<null, OrderDomainError> {
  const state = lifecycle(order);
  if (!state.success) return state;
  if (state.data.status === "cancelled") return failure("ORDER_CANCELLED", "Order is cancelled");
  return order.deliveryStatus === "pending" ? ok(null) : failure("DELIVERY_LOCKED", "Delivery has progressed");
}

function registerPayment(order: OrderAggregate, payment: Payment): Result<OrderAggregate, OrderDomainError> {
  const state = lifecycle(order);
  if (!state.success) return state;
  if (state.data.status === "cancelled") return failure("ORDER_CANCELLED", "Order is cancelled");
  if (!uuid.test(payment.id) ||
    payment.orderId !== order.id || payment.method !== "digital_wallet" || !validDate(payment.recordedAt) || !validMoney(payment.amount, true)) return failure("INVALID_PAYMENT", "Invalid payment");
  if (payment.amount.currency !== order.total.currency) return failure("CURRENCY_MISMATCH", "Payment currency differs from order");
  const existing = order.payments.find((candidate) => candidate.id === payment.id);
  if (existing) return existing.orderId === payment.orderId && existing.amount.amount === payment.amount.amount && existing.amount.currency === payment.amount.currency && existing.method === payment.method
    ? ok(order) : failure("PAYMENT_CONFLICT", "Payment ID has different data");
  const next = { ...order, payments: [...order.payments, payment] };
  const summary = paymentSummary(next);
  if (!summary.success) return summary;
  return ok(order.deliveryStatus === "delivered" && summary.data.status === "paid" ? { ...next, completedAt: order.completedAt ?? payment.recordedAt } : next);
}

function planStockDeduction(order: OrderAggregate, requestedIfPartial: boolean): Result<StockDeductionPlan, OrderDomainError> {
  const state = lifecycle(order);
  if (!state.success) return state;
  if (state.data.status === "cancelled") return failure("ORDER_CANCELLED", "Order is cancelled");
  if (order.stockDeducted) return ok({ kind: "none", reason: "already_deducted", nextOrder: order });
  const summary = paymentSummary(order);
  if (!summary.success) return summary;
  if (summary.data.paidAmount.amount === 0 || (summary.data.status === "pending" && !requestedIfPartial))
    return ok({ kind: "none", reason: "not_requested", nextOrder: order });
  return ok({ kind: "deduct", nextOrder: { ...order, stockDeducted: true } });
}

function requireFulfillment(order: OrderAggregate): Result<null, OrderDomainError> {
  const state = lifecycle(order);
  if (!state.success) return state;
  if (state.data.status === "cancelled") return failure("ORDER_CANCELLED", "Order is cancelled");
  const summary = paymentSummary(order);
  if (!summary.success) return summary;
  if (summary.data.status !== "paid") return failure("PAYMENT_REQUIRED", "Order payment is not covered");
  if (!order.stockDeducted) return failure("STOCK_NOT_DEDUCTED", "Order stock is not deducted");
  return ok(null);
}

function registerShipment(order: OrderAggregate): Result<OrderAggregate, OrderDomainError> {
  const allowed = requireFulfillment(order);
  if (!allowed.success) return allowed;
  return order.deliveryStatus === "pending" ? ok({ ...order, deliveryStatus: "shipped" }) : failure("INVALID_TRANSITION", "Delivery is not pending");
}

function registerDelivery(order: OrderAggregate, completedAt: Date): Result<OrderAggregate, OrderDomainError> {
  const allowed = requireFulfillment(order);
  if (!allowed.success) return allowed;
  if (!validDate(completedAt)) return failure("INVALID_TRANSITION", "Invalid completion date");
  return order.deliveryStatus === "pending" || order.deliveryStatus === "shipped"
    ? ok({ ...order, deliveryStatus: "delivered", completedAt: new Date(completedAt) })
    : failure("INVALID_TRANSITION", "Delivery is already completed");
}

function cancel(order: OrderAggregate): Result<CancellationPlan, OrderDomainError> {
  const state = lifecycle(order);
  if (!state.success) return state;
  if (state.data.status === "cancelled") return ok({ nextOrder: order, restoreStock: false });
  if (order.deliveryStatus !== "pending") return failure("INVALID_TRANSITION", "Dispatched order cannot be cancelled here");
  return ok({ nextOrder: { ...order, cancelled: true, stockDeducted: false }, restoreStock: order.stockDeducted });
}

export const orderStateMachine = { setDelivery, canSetDelivery, registerPayment, planStockDeduction, registerShipment,
  registerDelivery, cancel, getPaymentSummary: paymentSummary, getLifecycle: lifecycle } as const;
