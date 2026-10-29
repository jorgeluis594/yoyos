import { z } from "zod";
import { currencies, type Money } from "@shared/money";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import { messageOpenIntervals, type MessageOpenInterval } from "@core/src/features/orders/domain/message-order";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ProductId } from "@core/src/features/products/domain/product";

/** A chat keeps at most this many pendings; the schema rejects more. */
export const maxChatPendings = 10;
/** A doubtful pending keeps at most this many candidate products. */
export const maxPendingCandidates = 4;

export type { ChatPendingId };
export type PendingSubject =
  /** (a) A product named without its full variant. */
  | Readonly<{ kind: "variant"; productId: ProductId }>
  /** (b) A doubtful product: two to `maxPendingCandidates` candidates. */
  | Readonly<{ kind: "product"; candidates: readonly [ProductId, ProductId, ...ProductId[]] }>;
/** forQuantity: the units the buyer stated the price for; the unit-or-lot basis is judged with it, never with a later partial assignment. */
export type PendingPrice = Readonly<{ amount: Money; per: "unit" | "lot" | "not_explicit"; forQuantity: PositiveInteger }>;
export type ChatPending = Readonly<{
  id: ChatPendingId;
  subject: PendingSubject;
  /** Catalog attribute names and values already given; never the buyer's words. */
  known: Readonly<Record<string, string>>;
  quantity: PositiveInteger;
  price: PendingPrice | null;
  /** The order the pending belongs to and when it joined it; null before any open order. */
  order: Readonly<{ orderId: OrderId; attachedAt: Date }> | null;
  lastChangedAt: Date;
  sourceMessageId: ChatMessageId;
  /** The buyer's request this pending comes from: its own id at creation, copied to the parts a split creates. A lot price belongs to one request. */
  requestId: ChatPendingId;
}>;
export type ChatPendings = Readonly<{ pendings: readonly ChatPending[]; readyRemembered: boolean }>;

/** What pendingLife reads: the chat's order target (locked or not, same shape) and, when an orderless pending exists, the chat orders that may have opened since the oldest orderless change. */
export type PendingLifeFacts = Readonly<{ target: ChatOrderTarget; openedSince: readonly OrderAggregate[] }>;
export type PendingLife = Readonly<{
  alive: readonly ChatPending[];
  ended: readonly Readonly<{ id: ChatPendingId; reason: "order_closed" | "expired" }>[];
}>;

const uuid = z.uuid();
const pendingId = uuid.transform((value) => value as ChatPendingId);
const productId = uuid.transform((value) => value as ProductId);
const positiveInteger = z.number().int().min(1).transform((value) => value as PositiveInteger);
const date = z.iso.datetime().transform((value) => new Date(value));
const money = z.strictObject({ amount: z.number().finite().positive(), currency: z.enum(currencies) });
const candidates = z.array(productId).min(2).max(maxPendingCandidates) as unknown as z.ZodType<readonly [ProductId, ProductId, ...ProductId[]]>;

const pendingSchema = z.strictObject({
  id: pendingId,
  subject: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("variant"), productId }),
    z.strictObject({ kind: z.literal("product"), candidates }),
  ]),
  known: z.record(z.string().min(1), z.string().min(1)),
  quantity: positiveInteger,
  price: z.strictObject({ amount: money, per: z.enum(["unit", "lot", "not_explicit"]), forQuantity: positiveInteger }).nullable(),
  order: z.strictObject({ orderId: uuid.transform((value) => value as OrderId), attachedAt: date }).nullable(),
  lastChangedAt: date,
  sourceMessageId: uuid.transform((value) => value as ChatMessageId),
  requestId: pendingId,
});

/** Validates the pendings JSON on write and on read (dates as ISO strings); a stored mismatch is `INVALID_STORED_DATA`. */
export const chatPendingsSchema: z.ZodType<ChatPendings> = z.strictObject({
  pendings: z.array(pendingSchema).max(maxChatPendings),
  readyRemembered: z.boolean(),
});

/**
 * Decides each pending on its own, from the chat's order target and the orders that opened since its last change.
 * An attached pending lives while its order stays the open target and no payment was created after it joined.
 * An orderless pending joins the first interval that opens strictly after its last change, within its `ttlMs`, and otherwise expires.
 */
export function pendingLife(pendings: ChatPendings, facts: PendingLifeFacts, now: Date, ttlMs: number): PendingLife {
  const intervals = openIntervalsByOrder(facts);
  const alive: ChatPending[] = [];
  const ended: Array<PendingLife["ended"][number]> = [];
  for (const pending of pendings.pendings) {
    const order = pending.order ?? joinedOrder(pending, intervals, ttlMs);
    if (!order && now.getTime() >= pending.lastChangedAt.getTime() + ttlMs) ended.push({ id: pending.id, reason: "expired" });
    else if (!order) alive.push(pending);
    else if (attachedAlive(order, facts.target, intervals)) alive.push({ ...pending, order });
    else ended.push({ id: pending.id, reason: "order_closed" });
  }
  return { alive, ended };
}

type OrderIntervals = ReadonlyMap<OrderId, readonly MessageOpenInterval[]>;

function openIntervalsByOrder(facts: PendingLifeFacts): OrderIntervals {
  const orders = new Map<OrderId, OrderAggregate>(facts.openedSince.map((order) => [order.id, order]));
  if (facts.target.kind === "open") orders.set(facts.target.order.id, facts.target.order);
  return new Map([...orders].map(([orderId, order]) => [orderId, order.chatId ? messageOpenIntervals(order, order.chatId) : []]));
}

/** The order an orderless pending joined by derivation: the earliest interval to start after its last change, if within its lifetime. */
function joinedOrder(pending: ChatPending, intervals: OrderIntervals, ttlMs: number): ChatPending["order"] {
  let joined: ChatPending["order"] = null;
  for (const [orderId, spans] of intervals) {
    for (const span of spans) {
      if (span.from.getTime() <= pending.lastChangedAt.getTime()) continue;
      if (!joined || span.from.getTime() < joined.attachedAt.getTime()) joined = { orderId, attachedAt: span.from };
    }
  }
  return joined && joined.attachedAt.getTime() <= pending.lastChangedAt.getTime() + ttlMs ? joined : null;
}

function attachedAlive(order: NonNullable<ChatPending["order"]>, target: ChatOrderTarget, intervals: OrderIntervals): boolean {
  if (target.kind !== "open" || target.order.id !== order.orderId) return false;
  return (intervals.get(order.orderId) ?? []).some((span) => span.until === null && span.from.getTime() <= order.attachedAt.getTime());
}
