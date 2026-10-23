import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildPendingOrder, orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatMessageOutcome, ChatMessageOutcomes, ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { CompanyId, ContactId, MentionedPrice, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

/** Why a chat has no order to change decides the outcome, so a missing order is not a bare null. */
export type ChatOrderTarget =
  | Readonly<{ kind: "open"; order: OrderAggregate; productIds: ReadonlyMap<VariantId, ProductId> }>
  | Readonly<{ kind: "closed"; orderId: OrderId; number: OrderNumber }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "none" }>;

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
  | Extract<ChatMessageOutcome, { kind: "not_identified" | "not_clear" | "unclear_item" }>
  | Readonly<{ kind: "variant_missing" | "variant_not_available"; productId: ProductId; identification: ProductIdentification | null }>;

/** The only input of the transitions: model output never reaches the domain. */
export type ResolvedChatAction =
  | Readonly<{ kind: "add"; item: ChatOrderCatalogItem; quantity: PositiveInteger; mentionedPrice: MentionedPrice | null; identification: ProductIdentification }>
  | Readonly<{ kind: "remove"; target: ItemTarget; amount: "all" | "one" }>
  | Readonly<{ kind: "set_quantity"; target: ItemTarget; quantity: number }>
  | Readonly<{ kind: "change_variant"; target: ItemTarget; to: ChangeVariantResolution; mentionedPrice: MentionedPrice | null }>
  | Readonly<{ kind: "set_mentioned_price"; target: ItemTarget; price: MentionedPrice | null }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "report"; outcome: ReportOutcome }>;

/** Everything a new chat order needs besides its items. The use case allocates `number` only when `needsNewChatOrder` says so. */
export type NewChatOrderSeed = Readonly<{ number: OrderNumber; companyId: CompanyId; sellerId: UserId; chatId: ChatId; contactId: ContactId }>;

/** Row changes of the chat's open order: items are compared by id, and a replaced variant is a removed item plus an added one. */
export type ChatOrderItemChanges = Readonly<{ added: readonly OrderItem[]; updated: readonly OrderItem[]; removedItemIds: readonly OrderItemId[] }>;

export type ChatOrderLimits = Readonly<{ maxItemQuantity: PositiveInteger }>;
export type ChatOrderIds = Readonly<{ newOrderId: () => OrderId; newItemId: () => OrderItemId }>;
export type AppliedChatActions = Readonly<{ target: ChatOrderTarget; createdOrder: OrderAggregate | null; changes: ChatOrderItemChanges; outcomes: ChatMessageOutcomes }>;

type State = {
  target: ChatOrderTarget;
  createdOrder: OrderAggregate | null;
  productIds: Map<VariantId, ProductId>;
  outcomes: ChatMessageOutcome[];
};
type Step = Result<null, OrderDomainError>;
const done: Step = ok(null);

/** True when applying the actions to the target creates an order: an add that fits the limit while no order is open. */
export function needsNewChatOrder(target: ChatOrderTarget, actions: readonly ResolvedChatAction[], limits: ChatOrderLimits): boolean {
  return target.kind !== "open" && actions.some((action) => action.kind === "add" && action.quantity <= limits.maxItemQuantity);
}

export function applyChatActions(target: ChatOrderTarget, actions: readonly ResolvedChatAction[], ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Result<AppliedChatActions, OrderDomainError> {
  if (actions.length === 0) return err({ code: "INVALID_ORDER", message: "A message needs at least one action" });
  const state: State = { target, createdOrder: null, productIds: new Map(target.kind === "open" ? target.productIds : []), outcomes: [] };
  for (const action of actions) {
    const step = applyAction(state, action, ids, now, limits, seed);
    if (!step.success) return step;
  }
  const [first, ...rest] = state.outcomes;
  if (!first) return err({ code: "INVALID_ORDER", message: "A message needs at least one outcome" });
  const next: ChatOrderTarget = state.target.kind === "open" ? { ...state.target, productIds: state.productIds } : state.target;
  return ok({ target: next, createdOrder: state.createdOrder, changes: diffItems(target, state), outcomes: [first, ...rest] });
}

function applyAction(state: State, action: ResolvedChatAction, ids: ChatOrderIds, now: Date, limits: ChatOrderLimits, seed: NewChatOrderSeed): Step {
  switch (action.kind) {
    case "add": return addItem(state, action, ids, now, limits, seed);
    case "report": state.outcomes.push(action.outcome); return done;
    case "ready": return markReady(state);
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

function setOrder(state: State, order: OrderAggregate): void {
  if (state.target.kind !== "open") return;
  state.target = { ...state.target, order };
  if (state.createdOrder) state.createdOrder = order;
}

function productOf(state: State, variantId: VariantId): Result<ProductId, OrderDomainError> {
  const productId = state.productIds.get(variantId);
  return productId ? ok(productId) : err({ code: "INVALID_ORDER", message: "Item has no known product" });
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

function markReady(state: State): Step {
  state.outcomes.push(state.target.kind === "open" ? { kind: "ready", orderId: state.target.order.id } : { kind: "no_intent" });
  return done;
}

/** Finds the order and item an item action applies to, or records why nothing can change. */
function withOrderItem(state: State, target: ItemTarget, change: (order: OrderAggregate, item: OrderItem, namedItem: boolean) => Step): Step {
  if (state.target.kind === "closed") { state.outcomes.push({ kind: "order_closed", orderId: state.target.orderId }); return done; }
  if (state.target.kind !== "open") { state.outcomes.push({ kind: "no_open_order" }); return done; }
  const order = state.target.order;
  const found = resolveItem(order, target);
  if (found.kind === "unclear") { state.outcomes.push({ kind: "unclear_item", namedItem: found.namedItem, namedProductId: found.namedProductId }); return done; }
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
  if (quantity > limits.maxItemQuantity) return reportAboveLimit(state, item.variantId);
  const next = orderStateMachine.setItemQuantity(order, item.id, quantity);
  if (!next.success) return next;
  setOrder(state, next.data);
  state.outcomes.push(kind === "quantity_lowered" ? { kind, variantId: item.variantId, namedItem } : { kind, variantId: item.variantId, quantity: quantity as PositiveInteger, namedItem });
  return done;
}

function reportAboveLimit(state: State, variantId: VariantId): Step {
  const productId = productOf(state, variantId);
  if (!productId.success) return productId;
  state.outcomes.push({ kind: "quantity_above_limit", productId: productId.data, identification: null });
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
    if (merged && merged.quantity + item.quantity > limits.maxItemQuantity) return reportAboveLimit(state, item.variantId);
    const productId = productOf(state, item.variantId);
    if (!productId.success) return productId;
    const next = orderStateMachine.replaceItemVariant(order, item.id, to, action.mentionedPrice, ids.newItemId);
    if (!next.success) return next;
    setOrder(state, next.data);
    state.productIds.set(to.variantId, productId.data);
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
