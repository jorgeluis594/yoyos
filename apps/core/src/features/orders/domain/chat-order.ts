import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildPendingOrder, orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import { advancePending, attachOrderless, declinePending, describePendings, draftPending, type AdvanceRequest, type PendingDraft, type PendingStep, type TransitionEnv } from "@core/src/features/orders/domain/pending-transitions";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatMessageOutcome, ChatMessageOutcomes, ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId, ContactId, MentionedPrice, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

export type { ChatOrderTarget };

export type ItemTarget =
  | Readonly<{ kind: "variant"; variantId: VariantId }>
  | Readonly<{ kind: "unnamed" }>
  | Readonly<{ kind: "unclear"; namedItem: boolean; namedProductId: ProductId | null }>;

export type ChatOrderCatalogItem = Pick<OrderItem, "variantId" | "productName" | "variantAttributes" | "sku" | "unitPrice">;

/** The variant a change moves to. A failed resolution keeps the product to name in the report. */
export type ChangeVariantResolution =
  | Readonly<{ kind: "resolved"; item: ChatOrderCatalogItem }>
  | Readonly<{ kind: "missing" | "not_available"; productId: ProductId }>;

export type ReportOutcome =
  | Readonly<{ kind: "no_intent" | "ambiguous_intent" | "variant_only" | "unnamed_add" | "image_with_request" }>
  | Extract<ChatMessageOutcome, { kind: "not_identified" | "not_clear" | "unclear_item" | "reader_doubt" | "request_not_allowed" | "invalid_action" | "product_not_available" | "variant_for_several_pendings" }>
  | Readonly<{ kind: "variant_missing" | "variant_not_available"; productId: ProductId; identification: ProductIdentification | null }>;

/** The only input of the transitions: model output never reaches the domain. */
export type ResolvedChatAction =
  | Readonly<{ kind: "add"; item: ChatOrderCatalogItem; quantity: PositiveInteger; mentionedPrice: MentionedPrice | null; identification: ProductIdentification }>
  | Readonly<{ kind: "remove"; target: ItemTarget; amount: "all" | "one" }>
  | Readonly<{ kind: "set_quantity"; target: ItemTarget; quantity: number }>
  | Readonly<{ kind: "change_variant"; target: ItemTarget; to: ChangeVariantResolution; mentionedPrice: MentionedPrice | null }>
  | Readonly<{ kind: "set_mentioned_price"; target: ItemTarget; price: MentionedPrice | null }>
  | Readonly<{ kind: "increase_quantity"; target: ItemTarget; quantity: PositiveInteger }>
  /** A product with no open pending before the message becomes one. */
  | Readonly<{ kind: "draft_pending"; draft: PendingDraft }>
  /** A later message naming a pending's product. `otherwise` is the action when the pending is gone by the time it applies (ended under the lock, or completed by an earlier action). */
  | Readonly<{ kind: "advance_pending"; request: AdvanceRequest; otherwise: ResolvedChatAction }>
  | Readonly<{ kind: "decline_pending"; pendingId: ChatPendingId }>
  /** The caption of this product's photo was doubted: the order domain tells the seller what the photo did. */
  | Readonly<{ kind: "caption_doubt"; productId: ProductId; identification: ProductIdentification | null }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "report"; outcome: ReportOutcome }>;

/** Everything a new chat order needs besides its items. The use case allocates `number` only when `needsNewChatOrder` says so. */
export type NewChatOrderSeed = Readonly<{ number: OrderNumber; companyId: CompanyId; sellerId: UserId; chatId: ChatId; contactId: ContactId;
  /** The message being applied: the source of the pendings it creates. */
  messageId: ChatMessageId }>;

/** Row changes of the chat's open order: items are compared by id, and a replaced variant is a removed item plus an added one. */
export type ChatOrderItemChanges = Readonly<{ added: readonly OrderItem[]; updated: readonly OrderItem[]; removedItemIds: readonly OrderItemId[] }>;

export type ChatOrderLimits = Readonly<{ maxItemQuantity: PositiveInteger }>;
export type ChatOrderIds = Readonly<{ newOrderId: () => OrderId; newItemId: () => OrderItemId; newPendingId: () => ChatPendingId }>;
export type AppliedChatActions = Readonly<{ target: ChatOrderTarget; createdOrder: OrderAggregate | null; changes: ChatOrderItemChanges; pendings: ChatPendings; outcomes: ChatMessageOutcomes }>;

type State = {
  /** The target as it was before this message, which item actions resolve against even after an add created a new order. */
  readonly original: ChatOrderTarget;
  target: ChatOrderTarget;
  createdOrder: OrderAggregate | null;
  productIds: Map<VariantId, ProductId>;
  outcomes: ChatMessageOutcome[];
  pendings: ChatPendings;
  /** The pendings before the message. */
  readonly pendingsBefore: number;
  readyRequested: boolean;
  /** An add or a new pending drops the «listo» the chat remembered. */
  newRequest: boolean;
  /** A pending was completed or declined by the buyer (not ended by the system). */
  pendingResolved: boolean;
  captionDoubts: Array<Extract<ResolvedChatAction, { kind: "caption_doubt" }>>;
};
type Step = Result<null, OrderDomainError>;
const done: Step = ok(null);

/** True when applying the actions creates an order: an add that fits the limit, or a pending completion, while no order is open. */
export function needsNewChatOrder(target: ChatOrderTarget, pendings: ChatPendings, actions: readonly ResolvedChatAction[], limits: ChatOrderLimits): boolean {
  if (target.kind === "open") return false;
  const zero = "00000000-0000-4000-8000-000000000000";
  let counter = 0;
  const unique = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const dryRun = applyChatActions(target, pendings, actions, { newOrderId: () => zero as OrderId, newItemId: () => unique() as OrderItemId, newPendingId: () => unique() as ChatPendingId }, new Date(0), limits,
    { number: 1001 as OrderNumber, companyId: zero as CompanyId, sellerId: "dry-run" as UserId, chatId: zero as ChatId, contactId: zero as ContactId, messageId: zero as ChatMessageId });
  return dryRun.success && dryRun.data.createdOrder !== null;
}

export function applyChatActions(target: ChatOrderTarget, pendings: ChatPendings, actions: readonly ResolvedChatAction[], ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Result<AppliedChatActions, OrderDomainError> {
  if (actions.length === 0) return err({ code: "INVALID_ORDER", message: "A message needs at least one action" });
  const state: State = { original: target, target, createdOrder: null, productIds: new Map(target.kind === "open" ? target.productIds : []), outcomes: [], pendings,
    pendingsBefore: pendings.pendings.length, readyRequested: false, newRequest: false, pendingResolved: false, captionDoubts: [] };
  for (const action of actions) {
    const step = applyAction(state, action, ids, now, limits, seed);
    if (!step.success) return step;
  }
  finishPendings(state, now);
  const [first, ...rest] = state.outcomes;
  if (!first) return err({ code: "INVALID_ORDER", message: "A message needs at least one outcome" });
  const next: ChatOrderTarget = state.target.kind === "open" ? { ...state.target, productIds: state.productIds } : state.target;
  return ok({ target: next, createdOrder: state.createdOrder, changes: diffItems(target, state), pendings: state.pendings, outcomes: [first, ...rest] });
}

function applyAction(state: State, action: ResolvedChatAction, ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Step {
  switch (action.kind) {
    case "add": state.newRequest = true; return addItem(state, action, ids, now, limits, seed);
    case "report": return report(state, action.outcome);
    case "ready": state.readyRequested = true; return done;
    case "increase_quantity": return withOrderItem(state, action.target, (order, item, named) => changeQuantity(state, order, item, item.quantity + action.quantity, named, "quantity_changed", limits));
    case "draft_pending": return draft(state, action.draft, ids, now, limits, seed);
    case "advance_pending": return advance(state, action, ids, now, limits, seed);
    case "decline_pending": return decline(state, action.pendingId);
    case "caption_doubt": state.captionDoubts.push(action); return done;
    case "remove": return withOrderItem(state, action.target, (order, item, named) => action.amount === "one" && item.quantity > 1
      ? changeQuantity(state, order, item, item.quantity - 1, named, "quantity_lowered", limits) : removeFromOrder(state, order, item, named));
    case "set_quantity": return withOrderItem(state, action.target, (order, item, named) => action.quantity === 0 ? removeFromOrder(state, order, item, named)
      : Number.isSafeInteger(action.quantity) && action.quantity > 0 ? changeQuantity(state, order, item, action.quantity, named, "quantity_changed", limits)
        : err({ code: "INVALID_ORDER", message: "Quantity must be a whole number" }));
    case "change_variant": return changeVariant(state, action, ids, limits);
    case "set_mentioned_price": return withOrderItem(state, action.target, (order, item) => {
      if (!action.price) { state.outcomes.push({ kind: "no_intent" }); return done; }
      const next = orderStateMachine.setItemMentionedPrice(order, item.id, action.price);
      if (!next.success) return next;
      setOrder(state, next.data);
      state.outcomes.push({ kind: "mentioned_price_set", variantId: item.variantId });
      return done;
    });
  }
}

/** A report that points at the chat order (unclear item, doubt, a request not allowed, an invalid action) carries the order it was read against, when the chat has an open one. */
function report(state: State, outcome: ReportOutcome): Step {
  const open = state.original.kind === "open" ? state.original.order.id : null;
  const carriesOrder = outcome.kind === "unclear_item" || outcome.kind === "reader_doubt" || outcome.kind === "request_not_allowed" || outcome.kind === "invalid_action";
  state.outcomes.push(carriesOrder && outcome.orderId === null ? { ...outcome, orderId: open } : outcome);
  return done;
}

function setOrder(state: State, order: OrderAggregate): void {
  if (state.target.kind !== "open") return;
  state.target = { ...state.target, order };
  if (state.createdOrder) state.createdOrder = order;
}

function addItem(state: State, action: Extract<ResolvedChatAction, { kind: "add" }>, ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Step {
  const { item, quantity, mentionedPrice, identification } = action;
  const existing = state.target.kind === "open" ? state.target.order.items.find((line) => line.variantId === item.variantId) : undefined;
  if (quantity + (existing?.quantity ?? 0) > limits.maxItemQuantity) {
    state.outcomes.push({ kind: "quantity_above_limit", productId: identification.productId, identification });
    return done;
  }
  state.productIds.set(item.variantId, identification.productId);
  const added: ChatMessageOutcome = { kind: "added", variantId: item.variantId, quantity, identification };
  if (state.target.kind === "open") {
    const next = orderStateMachine.appendItems(state.target.order, [{ ...item, quantity, mentionedPrice }], ids.newItemId);
    if (!next.success) return next;
    setOrder(state, next.data);
    state.outcomes.push(added);
    return done;
  }
  const previous = state.target.kind === "closed" ? state.target : null;
  const order = buildPendingOrder({ number: seed.number, id: ids.newOrderId(), companyId: seed.companyId, sellerId: seed.sellerId,
    customer: { kind: "contact", contactId: seed.contactId, name: null, phone: null }, createdAt: now,
    items: [{ id: ids.newItemId(), ...item, quantity, mentionedPrice }] });
  if (!order.success) return order;
  const created: OrderAggregate = { ...order.data, chatId: seed.chatId };
  state.createdOrder = created;
  state.target = { kind: "open", order: created, productIds: state.productIds };
  if (previous) state.outcomes.push({ kind: "new_order_after_closed", orderId: created.id, previousOrderId: previous.orderId });
  state.outcomes.push(added);
  return done;
}

function transitionEnv(state: State, ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): TransitionEnv {
  const quantityOf = (variantId: VariantId) => (state.target.kind === "open" ? state.target.order.items.find((item) => item.variantId === variantId)?.quantity ?? 0 : 0);
  return { now, maxItemQuantity: limits.maxItemQuantity, newPendingId: ids.newPendingId, sourceMessageId: seed.messageId, existingQuantity: quantityOf };
}

function takeStep(state: State, step: PendingStep): void {
  state.pendings = step.set;
  state.outcomes.push(...step.outcomes);
}

function draft(state: State, pendingDraft: PendingDraft, ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Step {
  const step = draftPending(state.pendings, pendingDraft, transitionEnv(state, ids, now, limits, seed));
  if (step.outcomes.some((outcome) => outcome.kind === "pending_created")) state.newRequest = true;
  takeStep(state, step);
  return done;
}

function decline(state: State, pendingId: ChatPendingId): Step {
  const step = declinePending(state.pendings, pendingId);
  if (step.outcomes.length === 0) state.outcomes.push({ kind: "no_intent" });
  else state.pendingResolved = true;
  takeStep(state, step);
  return done;
}

/** Advances the pending, or applies `otherwise` when it is gone. The covered units that complete become items of the chat order. */
function advance(state: State, action: Extract<ResolvedChatAction, { kind: "advance_pending" }>, ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Step {
  if (!state.pendings.pendings.some((pending) => pending.id === action.request.pendingId)) return applyAction(state, action.otherwise, ids, now, limits, seed);
  const step = advancePending(state.pendings, action.request, transitionEnv(state, ids, now, limits, seed));
  takeStep(state, step);
  if (step.outcomes.some((outcome) => outcome.kind === "pending_completed")) state.pendingResolved = true;
  for (const added of step.adds) {
    const result = addItem(state, { kind: "add", ...added }, ids, now, limits, seed);
    if (!result.success) return result;
  }
  return done;
}

const openOrderId = (state: State): OrderId | null => (state.target.kind === "open" ? state.target.order.id : null);

/** After every action: pendings join the open order, the seller learns what a doubted photo caption did, and the remembered «listo» is evaluated. */
function finishPendings(state: State, now: Date): void {
  if (state.target.kind === "open") state.pendings = attachOrderless(state.pendings, state.target.order.id, now);
  for (const doubt of state.captionDoubts) noticeForDoubtedCaption(state, doubt);
  const left = state.pendings.pendings;
  let remembered = state.pendings.readyRemembered && !state.newRequest;
  if (state.readyRequested) {
    if (left.length > 0) { state.outcomes.push({ kind: "ready_with_pendings", orderId: openOrderId(state), ...describePendings(left) }); remembered = true; }
    else { state.outcomes.push(state.target.kind === "open" ? { kind: "ready", orderId: state.target.order.id } : { kind: "no_intent" }); remembered = false; }
  } else if (remembered && state.pendingsBefore > 0 && left.length === 0 && state.pendingResolved) {
    if (state.target.kind === "open") state.outcomes.push({ kind: "ready", orderId: state.target.order.id });
  }
  state.pendings = { ...state.pendings, readyRemembered: left.length > 0 && remembered };
}

/** A doubted caption's photo is still the request, but the seller is never left without a notice for it. */
function noticeForDoubtedCaption(state: State, doubt: Extract<ResolvedChatAction, { kind: "caption_doubt" }>): void {
  const { productId } = doubt;
  const hasNotice = state.outcomes.some((outcome) => ("productId" in outcome && outcome.productId === productId)
    || (outcome.kind === "not_clear" && outcome.productIds.includes(productId)));
  if (hasNotice) return;
  const pendingStays = state.pendings.pendings.some((pending) => pending.subject.kind === "variant" && pending.subject.productId === productId);
  if (pendingStays) state.outcomes.push({ kind: "variant_missing", productId, identification: doubt.identification });
  else if (state.outcomes.some((outcome) => outcome.kind === "added" && outcome.identification.productId === productId)) {
    state.outcomes.push({ kind: "caption_not_applied", productId, orderId: openOrderId(state) });
  }
}

/** Finds the order and item an item action applies to, or records why nothing can change. */
function withOrderItem(state: State, target: ItemTarget, change: (order: OrderAggregate, item: OrderItem, namedItem: boolean) => Step): Step {
  const base = state.createdOrder ? state.original : state.target;
  if (base.kind === "closed") { state.outcomes.push({ kind: "order_closed", orderId: base.orderId }); return done; }
  if (base.kind !== "open") { state.outcomes.push({ kind: "no_open_order" }); return done; }
  const order = base.order;
  const found = resolveItem(order, target);
  if (found.kind === "unclear") { state.outcomes.push({ kind: "unclear_item", orderId: order.id, namedItem: found.namedItem, namedProductId: found.namedProductId }); return done; }
  return change(order, found.item, found.namedItem);
}

type FoundItem = Readonly<{ kind: "found"; item: OrderItem; namedItem: boolean }> | Readonly<{ kind: "unclear"; namedItem: boolean; namedProductId: ProductId | null }>;

function resolveItem(order: OrderAggregate, target: ItemTarget): FoundItem {
  if (target.kind === "unclear") return target;
  if (target.kind === "unnamed") return order.items.length === 1 ? { kind: "found", item: order.items[0], namedItem: false } : { kind: "unclear", namedItem: false, namedProductId: null };
  const item = order.items.find((line) => line.variantId === target.variantId);
  return item ? { kind: "found", item, namedItem: true } : { kind: "unclear", namedItem: true, namedProductId: null };
}

function removeFromOrder(state: State, order: OrderAggregate, item: OrderItem, namedItem: boolean): Step {
  if (order.items.length === 1) { state.outcomes.push({ kind: "only_item_kept", orderId: order.id }); return done; }
  const next = orderStateMachine.removeItem(order, item.id);
  if (!next.success) return next;
  setOrder(state, next.data);
  state.outcomes.push({ kind: "removed", variantId: item.variantId, namedItem });
  return done;
}

function changeQuantity(state: State, order: OrderAggregate, item: OrderItem, quantity: number, namedItem: boolean, kind: "quantity_lowered" | "quantity_changed", limits: ChatOrderLimits): Step {
  if (quantity > limits.maxItemQuantity) return reportAboveLimit(state, order, item, namedItem);
  const next = orderStateMachine.setItemQuantity(order, item.id, quantity);
  if (!next.success) return next;
  setOrder(state, next.data);
  state.outcomes.push(kind === "quantity_lowered" ? { kind, variantId: item.variantId, namedItem } : { kind, variantId: item.variantId, quantity: quantity as PositiveInteger, namedItem });
  return done;
}

/** An item whose product the target does not know cannot be named, so it degrades to an unclear item instead of failing the message. */
function reportAboveLimit(state: State, order: OrderAggregate, item: OrderItem, namedItem: boolean): Step {
  const productId = state.productIds.get(item.variantId);
  state.outcomes.push(productId ? { kind: "quantity_above_limit", productId, identification: null } : { kind: "unclear_item", orderId: order.id, namedItem, namedProductId: null });
  return done;
}

function changeVariant(state: State, action: Extract<ResolvedChatAction, { kind: "change_variant" }>, ids: ChatOrderIds, limits: ChatOrderLimits): Step {
  return withOrderItem(state, action.target, (order, item, namedItem) => {
    if (action.to.kind !== "resolved") { state.outcomes.push({ kind: action.to.kind === "missing" ? "variant_missing" : "variant_not_available", productId: action.to.productId, identification: null }); return done; }
    const to = action.to.item;
    if (to.variantId === item.variantId) {
      if (!action.mentionedPrice) { state.outcomes.push({ kind: "no_intent" }); return done; }
      const priced = orderStateMachine.setItemMentionedPrice(order, item.id, action.mentionedPrice);
      if (!priced.success) return priced;
      setOrder(state, priced.data);
      state.outcomes.push({ kind: "mentioned_price_set", variantId: item.variantId });
      return done;
    }
    const merged = order.items.find((line) => line.variantId === to.variantId);
    if (merged && merged.quantity + item.quantity > limits.maxItemQuantity) return reportAboveLimit(state, order, item, namedItem);
    const productId = state.productIds.get(item.variantId);
    const next = orderStateMachine.replaceItemVariant(order, item.id, to, action.mentionedPrice, ids.newItemId);
    if (!next.success) return next;
    setOrder(state, next.data);
    if (productId) state.productIds.set(to.variantId, productId);
    state.outcomes.push({ kind: "variant_changed", fromVariantId: item.variantId, toVariantId: to.variantId, namedItem });
    return done;
  });
}

function diffItems(original: ChatOrderTarget, state: State): ChatOrderItemChanges {
  const empty: ChatOrderItemChanges = { added: [], updated: [], removedItemIds: [] };
  if (original.kind !== "open" || state.target.kind !== "open" || state.target.order.id !== original.order.id) return empty;
  const before = new Map(original.order.items.map((item) => [item.id, item]));
  const after = state.target.order.items;
  const same = (left: OrderItem, right: OrderItem) => left.quantity === right.quantity && JSON.stringify(left.mentionedPrice ?? null) === JSON.stringify(right.mentionedPrice ?? null);
  return {
    added: after.filter((item) => !before.has(item.id)),
    updated: after.filter((item) => { const previous = before.get(item.id); return previous !== undefined && !same(previous, item); }),
    removedItemIds: [...before.keys()].filter((itemId) => !after.some((item) => item.id === itemId)),
  };
}
