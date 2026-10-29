import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ChatMessageOutcome, ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";

/**
 * Every kind a seller notice has, including the ones whose data fields arrive with the single reader (`not_applied`, `caption_not_applied`,
 * `product_not_available`, `variant_for_several_pendings`, `ready_with_pendings`). Evals name the expected notice with these kinds.
 */
export const sellerNoticeKinds = [
  "not_identified", "not_clear", "variant_missing", "variant_not_available", "quantity_above_limit", "unclear_item", "unnamed_add", "variant_only",
  "image_with_request", "no_open_order", "failed", "order_closed", "several_problems", "only_item_kept", "ready", "new_order",
  "not_applied", "caption_not_applied", "product_not_available", "variant_for_several_pendings", "ready_with_pendings",
] as const;
export type SellerNoticeKind = (typeof sellerNoticeKinds)[number];

type NewOrderNote = Readonly<{ newOrderId: OrderId | null }>;
type ProblemNotice =
  | Readonly<{ kind: "not_identified"; source: "photo" | "text" }>
  | Readonly<{ kind: "not_clear"; productIds: readonly ProductId[] }>
  | Readonly<{ kind: "variant_missing" | "variant_not_available" | "quantity_above_limit"; productId: ProductId }>
  | Readonly<{ kind: "unclear_item"; orderId: OrderId | null; namedItem: boolean; namedProductId: ProductId | null }>
  | Readonly<{ kind: "unnamed_add" | "variant_only" | "image_with_request" | "no_open_order" | "failed" }>
  | Readonly<{ kind: "order_closed"; orderId: OrderId }>
  | Readonly<{ kind: "not_applied"; orderId: OrderId | null }>
  | Readonly<{ kind: "caption_not_applied"; productId: ProductId; orderId: OrderId | null }>
  | Readonly<{ kind: "product_not_available"; productId: ProductId | null }>
  /** `unnamed` counts the pendings the product list cannot name (doubtful product); a deleted product is counted by the texts. */
  | Readonly<{ kind: "variant_for_several_pendings"; productIds: readonly ProductId[]; unnamed: number }>
  /** `productIds` are up to three distinct identified products; the other `problemCount - productIds.length` problems are counted. */
  | Readonly<{ kind: "several_problems"; problemCount: number; productIds: readonly ProductId[] }>;

/** The one notice of a message. Ids only: product names and order numbers come with the texts. */
export type SellerNotice =
  | (ProblemNotice & NewOrderNote)
  | Readonly<{ kind: "only_item_kept" | "ready"; orderId: OrderId }>
  | Readonly<{ kind: "ready_with_pendings"; orderId: OrderId | null; productIds: readonly ProductId[]; unnamed: number }>
  | Readonly<{ kind: "new_order"; orderId: OrderId; previousOrderId: OrderId }>;

/** A claimed notice: who registered the message, the chat that groups it and the notice the outcomes call for. */
export type ClaimedNotice = Readonly<{ messageId: ChatMessageId; chatId: string; sessionId: string; notice: SellerNotice }>;

// The tuple and the union must list the same kinds: a kind added to one and not the other fails to compile.
type SameKinds = [SellerNotice["kind"]] extends [SellerNoticeKind] ? ([SellerNoticeKind] extends [SellerNotice["kind"]] ? true : never) : never;
export const sellerNoticeKindsMatch: SameKinds = true;

export type SellerNoticeTarget = Readonly<{ kind: "message" }> | Readonly<{ kind: "order"; orderId: OrderId }>;

const maxNamedProducts = 3;

function problemOf(outcome: ChatMessageOutcome): ProblemNotice | null {
  switch (outcome.kind) {
    case "not_identified": return outcome.silent ? null : { kind: "not_identified", source: outcome.source };
    case "not_clear": return outcome.silent ? null : { kind: "not_clear", productIds: outcome.productIds };
    case "variant_missing": case "variant_not_available": case "quantity_above_limit": return { kind: outcome.kind, productId: outcome.productId };
    case "unclear_item": return { kind: "unclear_item", orderId: outcome.orderId, namedItem: outcome.namedItem, namedProductId: outcome.namedProductId };
    case "unnamed_add": case "variant_only": case "image_with_request": case "no_open_order": return { kind: outcome.kind };
    case "order_closed": return { kind: "order_closed", orderId: outcome.orderId };
    case "failed": return { kind: "failed" };
    case "reader_doubt": case "request_not_allowed": case "invalid_action": return { kind: "not_applied", orderId: outcome.orderId };
    case "caption_not_applied": return { kind: "caption_not_applied", productId: outcome.productId, orderId: outcome.orderId };
    case "product_not_available": return { kind: "product_not_available", productId: outcome.productId };
    case "variant_for_several_pendings": return { kind: "variant_for_several_pendings", productIds: [...new Set(outcome.productIds)], unnamed: outcome.unnamed };
    default: return null;
  }
}

function orderOutcome<K extends "ready" | "only_item_kept">(outcomes: ChatMessageOutcomes, kind: K) {
  return outcomes.find((outcome): outcome is Readonly<{ kind: K; orderId: OrderId }> => outcome.kind === kind);
}

function namedProductOf(problem: ProblemNotice): ProductId | null {
  if (problem.kind === "variant_missing" || problem.kind === "variant_not_available" || problem.kind === "quantity_above_limit" || problem.kind === "caption_not_applied") return problem.productId;
  if (problem.kind === "product_not_available") return problem.productId;
  return problem.kind === "unclear_item" ? problem.namedProductId : null;
}

/** Chooses the single notice of a message, or null when the seller needs none. `no_intent`, `ambiguous_intent`, `pending_*` and silent misses never notify. */
export function chooseSellerNotice(outcomes: ChatMessageOutcomes): SellerNotice | null {
  const problems = outcomes.flatMap((outcome) => problemOf(outcome) ?? []);
  const created = outcomes.find((outcome): outcome is Extract<ChatMessageOutcome, { kind: "new_order_after_closed" }> => outcome.kind === "new_order_after_closed");
  if (problems.length > 1) {
    const productIds = [...new Set(problems.flatMap((problem) => namedProductOf(problem) ?? []))].slice(0, maxNamedProducts);
    return { kind: "several_problems", problemCount: problems.length, productIds, newOrderId: created?.orderId ?? null };
  }
  if (problems.length === 1) return { ...problems[0]!, newOrderId: created?.orderId ?? null };
  const pendingReady = outcomes.find((outcome): outcome is Extract<ChatMessageOutcome, { kind: "ready_with_pendings" }> => outcome.kind === "ready_with_pendings");
  if (pendingReady) return { kind: "ready_with_pendings", orderId: pendingReady.orderId, productIds: [...new Set(pendingReady.productIds)], unnamed: pendingReady.unnamed };
  const kept = orderOutcome(outcomes, "only_item_kept");
  if (kept) return { kind: "only_item_kept", orderId: kept.orderId };
  const ready = orderOutcome(outcomes, "ready");
  if (ready) return { kind: "ready", orderId: ready.orderId };
  return created ? { kind: "new_order", orderId: created.orderId, previousOrderId: created.previousOrderId } : null;
}

/** Order notices open the order; every other notice opens the chat on the message. */
export function sellerNoticeTarget(notice: SellerNotice): SellerNoticeTarget {
  return notice.kind === "only_item_kept" || notice.kind === "ready" || notice.kind === "new_order" ? { kind: "order", orderId: notice.orderId } : { kind: "message" };
}

/** A notice is due while the outcomes call for one and nobody claimed it yet. */
export const isNoticeDue = (outcomes: ChatMessageOutcomes, noticeSentAt: Date | null): boolean => noticeSentAt === null && chooseSellerNotice(outcomes) !== null;

/** The ids a notice carries, so its numbers and names are read in one query each. */
export function noticeReferences(notice: SellerNotice): Readonly<{ orderIds: readonly OrderId[]; productIds: readonly ProductId[] }> {
  const orderIds: OrderId[] = [];
  const productIds: ProductId[] = [];
  if ("orderId" in notice && notice.orderId) orderIds.push(notice.orderId);
  if ("previousOrderId" in notice) orderIds.push(notice.previousOrderId);
  if ("newOrderId" in notice && notice.newOrderId) orderIds.push(notice.newOrderId);
  if ("productId" in notice && notice.productId) productIds.push(notice.productId);
  if ("productIds" in notice) productIds.push(...notice.productIds);
  return { orderIds: [...new Set(orderIds)], productIds: [...new Set(productIds)] };
}
