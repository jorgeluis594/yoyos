import type { CheckedAction } from "@core/src/features/orders/domain/reader/decide";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";

/**
 * The urgent action for a request of the message that has no checked action: an intent whose quote was not found (dropped) or that the extraction left
 * out. A request never gets lost silently: the seller learns that the message asked for something the reader could not read.
 */
export const lostRequest = (request: RequestRef): CheckedAction => ({ request, action: { kind: "report", outcome: { kind: "reader_doubt", orderId: null } },
  signals: { quotesComplete: false, targetNamed: "context", variantChangeVerb: "not_applicable", candidates: "single" }, doubt: null,
  urgent: { problem: "reader_doubt", question: null }, blocked: null });

/**
 * The refs of the intents that have no checked action: the ones dropped, and the kept ones no extracted request answers. A request another request of
 * the same message absorbed is answered: the dedupe lists it in `absorbed`, and an action that folded it (a price or a quantity said with an add) lists it in its own `absorbed`.
 */
export function lostRequests(dropped: readonly RequestRef[], kept: readonly RequestRef[], checked: readonly CheckedAction[], absorbed: readonly RequestRef[] = []): readonly CheckedAction[] {
  const answered = new Set([...checked.flatMap((action) => [action.request, ...(action.absorbed ?? [])]), ...absorbed]);
  return [...dropped, ...kept.filter((request) => !answered.has(request))].map(lostRequest);
}
