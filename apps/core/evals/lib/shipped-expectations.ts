import type { MessageExpectation } from "@core/evals/cases/schema";
import { shippedReaderFeatures } from "@core/src/features/orders/infrastructure/shipped-reader-features";

/**
 * The payment-fallback scoring rule (technical design §2 «Payment fallback»): the fallback never decides a gate by case alternatives but by
 * rewriting, before matching, what the cases expect, from the reader features that ship.
 * - `paymentRequest` off: the reader maps payment requests to `request_not_allowed`, whose notice is the generic `not_applied`; an expected
 *   notice `payment_request` and an expected outcome `payment_requested` (a multiset, so the outcome too) are rewritten to those.
 * - `closedOrderLine` off: the reader is not told the order is closed, so a change to it gets the generic body; an expectation whose notice is
 *   `order_closed` is also accepted with notice `not_applied`, the same order and the outcomes unstated.
 * The alternative exists only inside the exact matcher: judge eligibility (`needsJudge`) reads the case as written.
 */
export type ShippedFeatures = typeof shippedReaderFeatures;

const withoutPayment = (expectation: MessageExpectation): MessageExpectation => ({
  ...expectation,
  ...(expectation.notice === "payment_request" ? { notice: "not_applied" as const } : {}),
  ...(expectation.outcomes ? { outcomes: expectation.outcomes.map((kind) => kind === "payment_requested" ? "request_not_allowed" as const : kind) } : {}),
});

export function shippedExpectations(expectations: readonly MessageExpectation[], features: ShippedFeatures = shippedReaderFeatures): readonly MessageExpectation[] {
  const rewritten = features.paymentRequest ? expectations : expectations.map(withoutPayment);
  if (features.closedOrderLine) return rewritten;
  const alternatives = rewritten.filter(({ notice }) => notice === "order_closed")
    .map(({ order }): MessageExpectation => ({ notice: "not_applied", ...(order ? { order } : {}) }));
  return [...rewritten, ...alternatives];
}
