import type { OrderStockDue } from "@shared/contracts/orders";
import { orderFulfillmentBlock } from "@shared/orders-fulfillment";
import type { DispatchDate } from "@shared/dispatch-date";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";
import { describeStockDue, isStockDeductionDue, type StockDue, type StockOrder, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";

export const DISPATCH_PAGE_SIZE = 20;

/** What the dispatch queue needs of a pending order: the stock rule's input plus what readiness and ordering read. */
export type DispatchCandidate = StockOrder & Readonly<{
  number: OrderNumber; scheduledDispatchDate: DispatchDate;
  deliveryMethod: "home" | "agency" | "store" | null; hasReportedPayment: boolean }>;
export type DispatchStock = Readonly<{ stockDue: StockDue | null; shortAtCurrentStock: readonly VariantId[] }>;
export type DispatchReadiness =
  | Readonly<{ kind: "ready"; operation: "ship" | "deliver" }>
  | Readonly<{ kind: "blocked"; operation: "ship" | "deliver"; reason:
      | Readonly<{ code: "SHIP_PAYMENT_REQUIRED" | "PAYMENT_REQUIRED"; pendingReport: boolean }>
      | Readonly<{ code: "STOCK_WAITING"; variantIds: readonly [VariantId, ...VariantId[]] }>
      | Readonly<{ code: "STOCK_DEDUCTING" | "STOCK_NOT_DEDUCTED" }> }>
  | Readonly<{ kind: "delivery_unassigned" }>;
export type DispatchGroup = "overdue" | "today";
export type ClassifiedCandidate = Readonly<{ candidate: DispatchCandidate; readiness: DispatchReadiness }>;
export type DispatchQueueSummary = Readonly<{ overdue: number; overdueReady: number; today: number; todayReady: number }>;
export type OrderedDispatchQueue = Readonly<{ members: readonly (ClassifiedCandidate & Readonly<{ group: DispatchGroup }>)[]; summary: DispatchQueueSummary }>;

const cents = (amount: number) => Math.round(amount * 100);
const confirmedCents = (order: StockOrder) => order.confirmedPayments.reduce((sum, payment) => sum + cents(payment.amount.amount), 0);

/** The orders whose items must be compared with current stock: due ones (for `stockDue`) and not-yet-deducted ones with a confirmed payment (partially paid, not due). */
export function needsStockRead(order: StockOrder): boolean {
  if (isStockDeductionDue(order)) return true;
  return !order.cancelled && !order.stockDeducted && order.deliveryStatus === "pending" && order.confirmedPayments.length > 0;
}

/** `stock` must contain the variants of any order for which `needsStockRead` is true; other orders are not compared, so a missing row never reads as zero stock for them. */
export function describeDispatchStockOf(order: StockOrder, stock: VariantStock): DispatchStock {
  if (!needsStockRead(order)) return { stockDue: null, shortAtCurrentStock: [] };
  return { stockDue: describeStockDue(order, stock),
    shortAtCurrentStock: order.items.filter((item) => (stock.get(item.variantId) ?? 0) < item.quantity).map((item) => item.variantId) };
}

/** `null` when the order is cancelled or no longer pending: it is not waiting for a dispatch. */
export function describeDispatchReadiness(order: DispatchCandidate, stock: DispatchStock): DispatchReadiness | null {
  if (order.cancelled || order.deliveryStatus !== "pending") return null;
  if (order.deliveryMethod === null) return { kind: "delivery_unassigned" };
  const operation = order.deliveryMethod === "store" ? "deliver" : "ship";
  const paid = confirmedCents(order);
  const block = orderFulfillmentBlock({ cancelled: order.cancelled, deliveryStatus: order.deliveryStatus, paymentStatus: paid >= cents(order.total.amount) ? "paid" : "pending",
    paidAmount: { amount: paid / 100 }, stockDeducted: order.stockDeducted, stockDue: stock.stockDue as OrderStockDue | null }, operation);
  if (block !== null) {
    if (block.code === "PAYMENT_REQUIRED") return { kind: "blocked", operation,
      reason: { code: operation === "ship" ? "SHIP_PAYMENT_REQUIRED" : "PAYMENT_REQUIRED", pendingReport: order.hasReportedPayment } };
    if (block.code === "STOCK_WAITING") return { kind: "blocked", operation, reason: { code: "STOCK_WAITING", variantIds: block.variantIds as readonly [VariantId, ...VariantId[]] } };
    if (block.code === "STOCK_DEDUCTING" || block.code === "STOCK_NOT_DEDUCTED") return { kind: "blocked", operation, reason: { code: block.code } };
    return null;
  }
  const [first, ...rest] = order.stockDeducted ? [] : stock.shortAtCurrentStock;
  if (first) return { kind: "blocked", operation, reason: { code: "STOCK_WAITING", variantIds: [first, ...rest] } };
  return { kind: "ready", operation };
}

export function classifyDispatchCandidate(candidate: DispatchCandidate, stock: VariantStock): Readonly<{ stock: DispatchStock; readiness: DispatchReadiness | null }> {
  const described = describeDispatchStockOf(candidate, stock);
  return { stock: described, readiness: describeDispatchReadiness(candidate, described) };
}

const isReady = (readiness: DispatchReadiness) => readiness.kind === "ready";

/** Overdue before today; inside each, ready before blocked; inside each part, oldest scheduled date then lowest number. Counts cover every member. */
export function orderDispatchQueue(members: readonly ClassifiedCandidate[], today: DispatchDate): OrderedDispatchQueue {
  const tagged = members.map((member) => ({ ...member, group: (member.candidate.scheduledDispatchDate < today ? "overdue" : "today") as DispatchGroup }));
  const rank = (member: (typeof tagged)[number]) => (member.group === "overdue" ? 0 : 2) + (isReady(member.readiness) ? 0 : 1);
  const sorted = [...tagged].sort((a, b) => rank(a) - rank(b) || (a.candidate.scheduledDispatchDate < b.candidate.scheduledDispatchDate ? -1
    : a.candidate.scheduledDispatchDate > b.candidate.scheduledDispatchDate ? 1 : 0) || a.candidate.number - b.candidate.number);
  const count = (group: DispatchGroup, onlyReady: boolean) => tagged.filter((member) => member.group === group && (!onlyReady || isReady(member.readiness))).length;
  return { members: sorted, summary: { overdue: count("overdue", false), overdueReady: count("overdue", true), today: count("today", false), todayReady: count("today", true) } };
}

export function pageOfDispatchQueue(queue: OrderedDispatchQueue, page: number): OrderedDispatchQueue["members"] {
  return queue.members.slice((page - 1) * DISPATCH_PAGE_SIZE, page * DISPATCH_PAGE_SIZE);
}
