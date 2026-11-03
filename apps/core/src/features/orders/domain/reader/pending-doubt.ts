import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { normalizeValue } from "@core/src/features/orders/domain/pending-transitions";
import type { ChangeDecision, DoubtReason, OriginalDoubtReason } from "@core/src/features/orders/domain/reader/decision";

/** What a completing message states itself: its justified quantity and its catalog values. */
export type StatedByMessage = Readonly<{ quantity: number | null; values: readonly Readonly<{ name: string; value: string }>[] }>;

const originalOf = (reason: DoubtReason): OriginalDoubtReason => (reason.kind === "inherited" ? reason.from : reason);

/** A pending change that is not high certainty is applied with a doubt: its «Por resolver» point restarts and is unacknowledged. */
export function withDecisionOnPending(pending: ChatPending, decision: ChangeDecision, now: Date): ChatPending {
  if (decision.kind !== "doubtful") return pending;
  // The values-alone doubt (it reuses the added-by-reference reason) never replaces a doubt the pending already carries.
  if (decision.reason.kind === "added_by_reference" && pending.doubt) return pending;
  return { ...pending, doubt: { reason: originalOf(decision.reason) }, pointSince: now, acknowledgedAt: null };
}

/** The point is acknowledged when a confirmed review showed it at or after it was set. */
export function isAcknowledged(pending: ChatPending): boolean {
  return pending.acknowledgedAt !== null && pending.acknowledgedAt.getTime() >= pending.pointSince.getTime();
}

function restates(reason: OriginalDoubtReason, said: StatedByMessage): boolean {
  switch (reason.kind) {
    // A partial completion states the units it covers, which is not the doubted quantity; only the same number restates it.
    case "quantity_set": case "added_by_reference": return said.quantity === reason.quantity;
    case "variant_changed": return said.values.some((entry) => normalizeValue(entry.name) === normalizeValue(reason.attribute) && normalizeValue(entry.value) === normalizeValue(reason.to));
    default: return false;
  }
}

/**
 * The mark each item created from a pending gets (completion or split): the pending's unacknowledged doubt, as an inherited reason holding the original.
 * Null when the pending has no doubt, a review acknowledged it, or the completing message states the doubted value itself (that message's own decision applies).
 */
export function inheritedMark(pending: ChatPending, said: StatedByMessage): DoubtReason | null {
  if (!pending.doubt || isAcknowledged(pending)) return null;
  const original = originalOf(pending.doubt.reason);
  return restates(original, said) ? null : { kind: "inherited", from: original };
}
