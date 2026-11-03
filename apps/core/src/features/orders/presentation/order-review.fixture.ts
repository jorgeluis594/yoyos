import { vi } from "vitest";
import { ok } from "@shared/functional";
import type { OrderReviewResponse, ConfirmOrderReviewResponse } from "@shared/contracts/order-review";
import type { OrderReviewApi } from "@core/src/features/orders/presentation/order-review-client";
import { deadpoolM, order1042, orderId, pen, trajeL, trajeM } from "@core/src/features/orders/presentation/order-1042.fixture";

/** The three lines of order #1042 are the items 1 to 3; the review fixtures speak about them. */
export const itemTrajeM = "00000000-0000-4000-8000-000000000001";
export const itemTrajeL = "00000000-0000-4000-8000-000000000002";
export const itemDeadpool = "00000000-0000-4000-8000-000000000003";
export const messageOne = "00000000-0000-4000-8000-0000000000d1";
export const messageTwo = "00000000-0000-4000-8000-0000000000d2";
const at = "2026-10-30T20:42:00.000Z";

type Line = NonNullable<OrderReviewResponse["doubtful"][number]["change"]["after"]>;
export const reviewLine = (itemId: string, variantId: string, productName: string, size: string, quantity: number, price: number): Line =>
  ({ itemId, variantId, productName, variantAttributes: { Talla: size }, sku: null, quantity, unitPrice: pen(price), mentionedPrice: null, position: 0 });
const deadpoolL = reviewLine(itemDeadpool, deadpoolM, "Disfraz de Deadpool", "L", 1, 120);
const deadpoolMLine = reviewLine(itemDeadpool, deadpoolM, "Disfraz de Deadpool", "M", 1, 120);

type Change = OrderReviewResponse["doubtful"][number]["change"];
export const doubtfulChange = (patch: Partial<Change> = {}): Change => ({
  id: "00000000-0000-4000-8000-0000000000c1", messageId: messageOne, position: 0, seq: 3, kind: "variant_changed", before: deadpoolL, after: deadpoolMLine,
  decision: { kind: "doubtful", reason: { kind: "variant_changed", attribute: "Talla", from: "L", to: "M" } }, verdict: null, createdAt: at, ...patch });
export const sureChange = (patch: Partial<Change> = {}): Change => ({ ...doubtfulChange(), id: "00000000-0000-4000-8000-0000000000c2", messageId: messageTwo, seq: 4, kind: "added",
  before: null, after: reviewLine("00000000-0000-4000-8000-000000000009", trajeL, "Gorra trucker", "Rojo", 1, 40), decision: { kind: "applied" }, ...patch });

export const point = (patch: Partial<OrderReviewResponse["points"][number]> = {}): OrderReviewResponse["points"][number] => ({
  pendingId: "00000000-0000-4000-8000-0000000000e1", since: at, kind: "variant_missing", product: "Polo básico", quantity: 2, missing: ["Talla"], doubt: null, acknowledged: false,
  question: "¿En qué talla quieres el Polo básico: S, M o L?", ...patch });

export const noPendings = { back: [], end: [] };

/** The review of order #1042 as a WhatsApp seller first sees it: one doubtful variant change, opened by the link. */
export function reviewJson(patch: Partial<OrderReviewResponse> = {}): OrderReviewResponse {
  const change = doubtfulChange();
  return {
    version: 1, status: { openForMessages: true, toReview: true, doubtfulCount: 1, pointCount: 0, entry: "link", hasPreviousReview: false },
    doubtful: [{ change, quote: "la quiero en M" }], points: [], products: [{ itemId: itemTrajeM, changedSinceLastReview: false }, { itemId: itemTrajeL, changedSinceLastReview: false }],
    removedSinceLastReview: [], messageRows: [{ messageId: messageOne, at, changes: [change], undo: { kind: "available" }, pendings: noPendings }], moreRows: 0,
    loaded: { changesThrough: 3, changeIds: [change.id], points: [], itemsRevision: "A".repeat(43) }, ...patch };
}
/** Nothing to review: an order made on the web, a cancelled or a completed one. */
export const noReview = (): OrderReviewResponse => reviewJson({ status: { openForMessages: false, toReview: false, doubtfulCount: 0, pointCount: 0, entry: "none", hasPreviousReview: false },
  doubtful: [], products: [], messageRows: [] });

export const whatsappOrder = (patch: Parameters<typeof order1042>[0] = {}) => order1042({ source: "whatsapp", checkoutEnabledAt: "2026-10-30T09:11:00.000Z", ...patch });

export const confirmed = (patch: Partial<ConfirmOrderReviewResponse> = {}): ConfirmOrderReviewResponse => ({ version: 1,
  review: { id: "00000000-0000-4000-8000-0000000000f1", origin: "link", correctedItems: 0, confirmedAt: at }, order: order1042({ source: "whatsapp" }), changedMeanwhile: [], total: pen(298), stockDue: null, ...patch });

/** A fake of the review API: every call answers what the test gave it. */
export function fakeApi(over: Partial<OrderReviewApi> = {}): { [K in keyof OrderReviewApi]: ReturnType<typeof vi.fn> & OrderReviewApi[K] } {
  return { load: vi.fn(async () => ok({ review: reviewJson(), order: whatsappOrder() })), confirm: vi.fn(async () => ok(confirmed())),
    undo: vi.fn(async () => ok({ order: whatsappOrder(), review: reviewJson({ doubtful: [], messageRows: [] }) })), recordLinkAction: vi.fn(async () => undefined), ...over } as never;
}
export { orderId, trajeM };
