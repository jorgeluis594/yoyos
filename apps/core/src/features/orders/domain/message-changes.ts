import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies, type Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import { maxChatPendings, type ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { isOpenForMessageItems } from "@core/src/features/orders/domain/message-order";
import type { OrderId, OrderItem, OrderItemId, PositiveInteger, MentionedPrice } from "@core/src/features/orders/domain/order";
import type { OrderItemChanges } from "@core/src/features/orders/domain/order-edit";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { ChangeDecision } from "@core/src/features/orders/domain/reader/decision";
import type { QuoteId } from "@core/src/features/orders/domain/reader/readings";
import type { VariantId } from "@core/src/features/products/domain/product";

export type OrderReviewId = string & { readonly __brand: "OrderReviewId" };
export type OrderItemChangeId = string & { readonly __brand: "OrderItemChangeId" };
/** Per-order, assigned under the order lock as the order's previous highest plus one. */
export type ChangeSeq = number & { readonly __brand: "ChangeSeq" };

export type LineSnapshot = Readonly<{ itemId: OrderItemId; variantId: VariantId; productName: string; variantAttributes: Readonly<Record<string, string>>;
  sku: string | null; quantity: PositiveInteger; unitPrice: Money; mentionedPrice: MentionedPrice | null; position: number }>;
export type OrderItemChangeKind = "added" | "removed" | "quantity_changed" | "variant_changed" | "mentioned_price_set";
export type ChangeVerdict = "kept" | "quantity_changed" | "removed" | "undone" | "not_reviewed";
/** One row per item change a message made. Marks, «Cambios por mensajes», undo, verdicts and labels derive from it. */
export type OrderItemChange = Readonly<{
  id: OrderItemChangeId; orderId: OrderId; messageId: ChatMessageId; position: number; seq: ChangeSeq; kind: OrderItemChangeKind;
  /** Null before = added, null after = removed. */
  before: LineSnapshot | null; after: LineSnapshot | null;
  decision: Extract<ChangeDecision, { kind: "applied" }> | Extract<ChangeDecision, { kind: "doubtful" }>;
  quoteId: QuoteId | null; supersededBy: OrderItemChangeId | null; reviewId: OrderReviewId | null;
  verdict: Readonly<{ kind: ChangeVerdict; at: Date }> | null; createdAt: Date;
}>;
export type MessageChanges = Readonly<{ orderId: OrderId; messageId: ChatMessageId; changes: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[]; supersedes: readonly OrderItemChangeId[] }>;

const uuid = z.uuid();
const moneySchema = z.strictObject({ amount: z.number().finite().min(0), currency: z.enum(currencies) });

/** The snapshot stored in `OrderItemChange.before/after`; a mismatch on read is invalid stored data. */
export const lineSnapshotSchema: z.ZodType<LineSnapshot> = z.strictObject({
  itemId: uuid.transform((value) => value as OrderItemId),
  variantId: uuid.transform((value) => value as VariantId),
  productName: z.string(),
  variantAttributes: z.record(z.string(), z.string()),
  sku: z.string().nullable(),
  quantity: z.number().int().min(1).transform((value) => value as PositiveInteger),
  unitPrice: moneySchema,
  mentionedPrice: z.strictObject({ amount: moneySchema, units: z.number().int().min(1) }).nullable(),
  position: z.number().int().min(0),
});

export type UndoRefusal = "order_moved_on" | "later_change" | "would_empty" | "not_sold";

const sameMoney = (a: Money, b: Money) => a.amount === b.amount && a.currency === b.currency;
const sameMentionedPrice = (a: MentionedPrice | null | undefined, b: MentionedPrice | null | undefined) =>
  a && b ? a.units === b.units && sameMoney(a.amount, b.amount) : !a && !b;
const roundCents = (value: number) => Math.round(value * 100) / 100;

export function snapshotOf(item: OrderItem, position: number): LineSnapshot {
  return { itemId: item.id, variantId: item.variantId, productName: item.productName, variantAttributes: item.variantAttributes, sku: item.sku,
    quantity: item.quantity, unitPrice: item.unitPrice, mentionedPrice: item.mentionedPrice ?? null, position };
}

const sameLine = (item: OrderItem, snapshot: LineSnapshot) => item.variantId === snapshot.variantId && item.quantity === snapshot.quantity
  && sameMoney(item.unitPrice, snapshot.unitPrice) && sameMentionedPrice(item.mentionedPrice, snapshot.mentionedPrice);

function itemOfSnapshot(snapshot: LineSnapshot): OrderItem {
  return { id: snapshot.itemId, variantId: snapshot.variantId, productName: snapshot.productName, variantAttributes: snapshot.variantAttributes, sku: snapshot.sku,
    quantity: snapshot.quantity, unitPrice: snapshot.unitPrice, subtotal: { ...snapshot.unitPrice, amount: roundCents(snapshot.unitPrice.amount * snapshot.quantity) },
    mentionedPrice: snapshot.mentionedPrice, stockDeductedQuantity: 0 };
}

export type DiffMessageChangesInput = Readonly<{
  orderId: OrderId; messageId: ChatMessageId;
  before: readonly OrderItem[]; after: readonly OrderItem[];
  /** The decision of the change on a variant; an applied message gives `applied` for every line. */
  decision: (variantId: VariantId) => OrderItemChange["decision"];
  /** The order's unverdicted changes that are not superseded yet, read under the order lock. */
  openChanges: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[];
  newChangeId: () => OrderItemChangeId; at: Date; nextSeq: ChangeSeq;
}>;

const withoutAcknowledgement = (pending: ChatPending): ChatPending => ({ ...pending, acknowledgedAt: null });
/** Acknowledging a point in a review is not a change of the pending. */
const samePending = (a: ChatPending, b: ChatPending) => isDeepStrictEqual(withoutAcknowledgement(a), withoutAcknowledgement(b));

/** The pendings whose value differs between two states, by id: what `OrderMessage.pendingsBefore/After` store. */
function diffPendings(before: readonly ChatPending[], after: readonly ChatPending[]): Pick<MessageChanges, "pendingsBefore" | "pendingsAfter"> {
  const previous = new Map(before.map((pending) => [pending.id, pending]));
  const next = new Map(after.map((pending) => [pending.id, pending]));
  const changed = new Set([...previous.keys(), ...next.keys()].filter((pendingId) => {
    const [a, b] = [previous.get(pendingId), next.get(pendingId)];
    return !a || !b || !isDeepStrictEqual(a, b);
  }));
  return { pendingsBefore: before.filter((pending) => changed.has(pending.id)), pendingsAfter: after.filter((pending) => changed.has(pending.id)) };
}

function kindOf(before: OrderItem | undefined, after: OrderItem | undefined): OrderItemChangeKind | null {
  if (!before) return "added";
  if (!after) return "removed";
  if (before.quantity !== after.quantity) return "quantity_changed";
  return sameMentionedPrice(before.mentionedPrice, after.mentionedPrice) ? null : "mentioned_price_set";
}

/** One change per line the message touched, keyed by variant: changed and added lines in the order of the result, then removed lines in the order they had. */
export function diffMessageChanges(input: DiffMessageChangesInput): MessageChanges {
  const previous = new Map(input.before.map((item, index) => [item.variantId, { item, index }]));
  const next = new Map(input.after.map((item, index) => [item.variantId, { item, index }]));
  const variants = [...input.after.map((item) => item.variantId), ...input.before.filter((item) => !next.has(item.variantId)).map((item) => item.variantId)];
  const changes: OrderItemChange[] = [];
  for (const variantId of variants) {
    const [was, is] = [previous.get(variantId), next.get(variantId)];
    const kind = kindOf(was?.item, is?.item);
    if (!kind) continue;
    changes.push({ id: input.newChangeId(), orderId: input.orderId, messageId: input.messageId, position: changes.length, seq: (input.nextSeq + changes.length) as ChangeSeq, kind,
      before: was ? snapshotOf(was.item, was.index) : null, after: is ? snapshotOf(is.item, is.index) : null, decision: input.decision(variantId),
      quoteId: null, supersededBy: null, reviewId: null, verdict: null, createdAt: input.at });
  }
  const touched = new Set(changes.map((change) => (change.after ?? change.before)!.itemId));
  const supersedes = input.openChanges.filter((open) => open.supersededBy === null && open.verdict === null && touched.has((open.after ?? open.before)!.itemId)).map((open) => open.id);
  return { orderId: input.orderId, messageId: input.messageId, changes, ...diffPendings(input.pendingsBefore, input.pendingsAfter), supersedes };
}

/** A doubtful change nobody has judged yet, on an order that can still change. */
export function isMarked(change: OrderItemChange, order: Pick<OrderAggregate, "cancelled" | "completedAt">): boolean {
  return change.decision.kind === "doubtful" && change.verdict === null && change.supersededBy === null && change.reviewId === null && !order.cancelled && order.completedAt === null;
}

/**
 * The first verdict stays, except `undone`, which replaces `kept`, `quantity_changed` and `removed` while the order is open for messages.
 * `not_reviewed` is final. Returns the verdict to store, or null when the stored one stays.
 */
export function nextVerdict(current: ChangeVerdict | null, incoming: ChangeVerdict, openForMessages: boolean): ChangeVerdict | null {
  if (current === null) return incoming;
  if (incoming === "undone" && openForMessages && (current === "kept" || current === "quantity_changed" || current === "removed")) return "undone";
  return null;
}

/** What undo reads about the message: its changes and the pendings it touched, as `OrderMessage` stores them. */
export type UndoMessage = Readonly<{ messageId: ChatMessageId; changes: readonly OrderItemChange[]; pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[] }>;
export type Undoability = Readonly<{ kind: "available" }> | Readonly<{ kind: "refused"; reason: UndoRefusal; variantId?: VariantId }>;

/** The lines as they were before the message: the newest change is inverted first; lines the message removed come back at their position. */
function linesBefore(items: readonly OrderItem[], changes: readonly OrderItemChange[]): readonly OrderItem[] {
  let lines = [...items];
  const restored: LineSnapshot[] = [];
  for (const change of [...changes].sort((a, b) => b.seq - a.seq)) {
    const { before, after } = change;
    const index = after ? lines.findIndex((line) => line.id === after.itemId) : -1;
    if (before && after && index >= 0 && before.itemId === after.itemId && before.variantId === after.variantId) {
      lines[index] = itemOfSnapshot(before);
      continue;
    }
    if (index >= 0) lines = lines.filter((_line, at) => at !== index);
    if (before) restored.push(before);
  }
  for (const snapshot of restored.sort((a, b) => a.position - b.position)) lines.splice(Math.min(snapshot.position, lines.length), 0, itemOfSnapshot(snapshot));
  return lines;
}

function pendingsMoved(message: UndoMessage, pendings: readonly ChatPending[]): boolean {
  const current = new Map(pendings.map((pending) => [pending.id, pending]));
  const left = new Map(message.pendingsAfter.map((pending) => [pending.id, pending]));
  for (const pendingId of new Set([...message.pendingsBefore, ...message.pendingsAfter].map((pending) => pending.id))) {
    const [now, expected] = [current.get(pendingId), left.get(pendingId)];
    if (!now !== !expected || (now && expected && !samePending(now, expected))) return true;
  }
  return false;
}

function linesMoved(message: UndoMessage, order: OrderAggregate, laterChanges: readonly OrderItemChange[]): boolean {
  return message.changes.some((change) => {
    const itemId = (change.after ?? change.before)!.itemId;
    if (change.supersededBy !== null) return true;
    if (laterChanges.some((later) => later.messageId !== change.messageId && later.seq > change.seq && (later.after ?? later.before)!.itemId === itemId)) return true;
    if (!change.after) return order.items.some((line) => line.variantId === change.before!.variantId);
    const line = order.items.find((candidate) => candidate.id === change.after!.itemId);
    return !line || !sameLine(line, change.after);
  });
}

export type UndoabilityInput = Readonly<{ order: OrderAggregate; message: UndoMessage; pendings: readonly ChatPending[];
  /** Changes of other messages newer than the message's own, for the order. */
  laterChanges: readonly OrderItemChange[]; sellable: readonly SellableVariant[] }>;

/** Whether the message can be undone on the locked order and pendings. Reasons are checked in the product's order. */
export function undoability(input: UndoabilityInput): Undoability {
  const { order, message } = input;
  if (!order.chatId || !isOpenForMessageItems(order, order.chatId)) return { kind: "refused", reason: "order_moved_on" };
  if (linesMoved(message, order, input.laterChanges) || pendingsMoved(message, input.pendings)) return { kind: "refused", reason: "later_change" };
  const restored = linesBefore(order.items, message.changes);
  if (restored.length === 0) return { kind: "refused", reason: "would_empty" };
  const sold = new Set(input.sellable.map((variant) => variant.variantId));
  const current = new Map(order.items.map((line) => [line.id, line]));
  const unsold = restored.find((line) => line.quantity > (current.get(line.id)?.quantity ?? 0) && !sold.has(line.variantId));
  return unsold ? { kind: "refused", reason: "not_sold", variantId: unsold.variantId } : { kind: "available" };
}

export type UndoPlan = Readonly<{ order: OrderAggregate; changes: OrderItemChanges; pendings: readonly ChatPending[]; pendingsRestored: number; pendingsEnded: number }>;
export type UndoPlanInput = Readonly<{ order: OrderAggregate; message: UndoMessage; pendings: readonly ChatPending[]; pendingTtlMs: number; now: Date; newItemId: () => OrderItemId }>;

/** A restored pending is dropped when its order is another one, or when it has no order and its time is up. */
function isRestorable(pending: ChatPending, orderId: OrderId, now: Date, ttlMs: number): boolean {
  if (pending.order) return pending.order.orderId === orderId;
  return now.getTime() < pending.lastChangedAt.getTime() + ttlMs;
}

/** The writes of an undo: the lines and the totals, and only the pendings the message touched (plus the one ended to keep the limit). */
export function undoPlan(input: UndoPlanInput): Result<UndoPlan, OrderDomainError> {
  const { order, message } = input;
  const rebuilt = orderStateMachine.appendItems({ ...order, items: linesBefore(order.items, message.changes) as unknown as OrderAggregate["items"] }, [], input.newItemId);
  if (!rebuilt.success) return err(rebuilt.error);
  const previous = new Map(order.items.map((item) => [item.id, item]));
  const kept = new Set(rebuilt.data.items.map((item) => item.id));
  const changes: OrderItemChanges = {
    added: rebuilt.data.items.filter((item) => !previous.has(item.id)),
    updated: rebuilt.data.items.filter((item) => {
      const was = previous.get(item.id);
      return was !== undefined && (was.quantity !== item.quantity || !sameMentionedPrice(was.mentionedPrice, item.mentionedPrice));
    }),
    removedItemIds: order.items.filter((item) => !kept.has(item.id)).map((item) => item.id),
  };
  const touched = new Set([...message.pendingsBefore, ...message.pendingsAfter].map((pending) => pending.id));
  const restored = message.pendingsBefore.filter((pending) => isRestorable(pending, order.id, input.now, input.pendingTtlMs));
  const others = input.pendings.filter((pending) => !touched.has(pending.id));
  const byAge = (a: ChatPending, b: ChatPending) => a.lastChangedAt.getTime() - b.lastChangedAt.getTime();
  let ended = 0;
  let remaining = [...others];
  while (remaining.length + restored.length > maxChatPendings && remaining.length > 0) {
    const [oldest] = [...remaining].sort(byAge);
    remaining = remaining.filter((pending) => pending !== oldest);
    ended += 1;
  }
  const pendings = [...remaining, ...restored].slice(-maxChatPendings);
  return ok({ order: rebuilt.data, changes, pendings, pendingsRestored: restored.length, pendingsEnded: ended });
}
