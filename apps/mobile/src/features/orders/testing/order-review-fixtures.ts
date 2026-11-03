import type { OrderReviewResponse } from "@shared/contracts/order-review";

/** Review responses as core would send them, for API fakes. */
export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pen = (amount: number) => ({ amount, currency: "PEN" as const });

export function reviewLine(n: number, overrides: Partial<OrderReviewResponse["removedSinceLastReview"][number]> = {}) {
  return { itemId: fixtureId(n), variantId: fixtureId(n + 100), productName: "Polera gris", variantAttributes: { Talla: "M" }, sku: null,
    quantity: 1, unitPrice: pen(59), mentionedPrice: null, position: 0, ...overrides };
}

export function reviewChange(n: number, overrides: Partial<OrderReviewResponse["messageRows"][number]["changes"][number]> = {}) {
  return { id: fixtureId(n + 200), messageId: fixtureId(n + 300), position: 0, seq: n, kind: "variant_changed" as const,
    before: reviewLine(n, { variantAttributes: { Talla: "L" } }), after: reviewLine(n),
    decision: { kind: "applied" as const }, verdict: null, createdAt: "2026-10-31T15:42:00.000Z", ...overrides };
}

export function emptyReview(overrides: Partial<OrderReviewResponse> = {}): OrderReviewResponse {
  return { version: 1, status: { openForMessages: true, toReview: false, doubtfulCount: 0, pointCount: 0, entry: "link", hasPreviousReview: false },
    doubtful: [], points: [], products: [], removedSinceLastReview: [], messageRows: [], moreRows: 0,
    loaded: { changesThrough: 0, changeIds: [], points: [], itemsRevision: "A".repeat(43) }, ...overrides };
}
