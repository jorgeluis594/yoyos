import type { Money } from "@shared/money";
import type { ChatMessageOutcome, ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ItemTarget, ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { maxPendingCandidates, type ChatPending, type ChatPendingId, type PhotoLeft } from "@core/src/features/orders/domain/chat-pendings";
import { mentionedPriceOf, type StatedPrice } from "@core/src/features/orders/domain/mentioned-price";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import { conflictsWithKnown, describePendings, normalizeValue, pendingPriceOf, resolveVariant, type AdvanceRequest, type AttributeChoice } from "@core/src/features/orders/domain/pending-transitions";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { productNameKey } from "@core/src/features/products/domain/product-name-key";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

/** A short reference valid for one reading only: "P1" products, "I1" items, "Q1" pendings. */
export type ReadingRef = string;

export type ReadingProduct = ProductForReading & Readonly<{
  ref: ReadingRef;
  /** The product a photo showed. */
  shown: boolean;
  shownVariantId: VariantId | null;
  identification: ProductIdentification | null;
}>;
export type ReadingItem = Readonly<{
  ref: ReadingRef;
  variantId: VariantId;
  productId: ProductId | null;
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  quantity: number;
  unitPrice: Money;
  /** True on the one line the photo just sent left; only tells the reader which line it is (the domain reads the context's `photoJustSent`). */
  photoJustSent: boolean;
}>;
export type ReadingPending = Readonly<{ ref: ReadingRef; pending: ChatPending; photoJustSent: boolean }>;

export type ChatReadingContext = Readonly<{
  kind: "text" | "photo_product" | "photo_not_product";
  /** The buyer's words: the text, or the photo's caption. Only the reader adapter reads it; domain logic never does. */
  text: string | null;
  /** The chat's latest order as the buyer sees it: a cancelled order counts as none. */
  latestOrder: "open" | "closed" | "none";
  items: readonly ReadingItem[];
  pendings: readonly ReadingPending[];
  products: readonly ReadingProduct[];
  /** What the photo just sent left, while it still is; always null when `kind` is not `text`. The domain reads this, not the line flags, so an unlisted item still counts. */
  photoJustSent: PhotoLeft | null;
  /** True when the product ceiling cut some of the products the reading wanted. */
  truncated: boolean;
}>;

export type { AttributeChoice, StatedPrice };
export type ReaderProduct =
  | Readonly<{ kind: "ref"; ref: ReadingRef }>
  | Readonly<{ kind: "one_of"; refs: readonly [ReadingRef, ReadingRef, ...ReadingRef[]] }>
  | Readonly<{ kind: "not_in_catalog" }>
  | Readonly<{ kind: "unnamed" }>;
export type ReaderItem = Readonly<{ kind: "ref"; ref: ReadingRef }> | Readonly<{ kind: "unnamed" }> | Readonly<{ kind: "not_in_order" }>;
/** Where a quantity change points: an order item as before, or a pending by its reference. */
export type ReaderQuantityTarget = ReaderItem | Readonly<{ kind: "pending"; ref: ReadingRef }>;

export type ReaderAction =
  | Readonly<{ kind: "add"; product: ReaderProduct; attributes: readonly AttributeChoice[]; quantity: number | null; price: StatedPrice | null }>
  | Readonly<{ kind: "complete_pending"; pending: ReadingRef; product: ReadingRef | null; attributes: readonly AttributeChoice[]; quantity: number | null; price: StatedPrice | null }>
  | Readonly<{ kind: "decline_pending"; pending: ReadingRef }>
  | Readonly<{ kind: "decline_shown" }>
  | Readonly<{ kind: "remove"; item: ReaderItem; amount: "all" | "one" }>
  | Readonly<{ kind: "change_quantity"; target: ReaderQuantityTarget; mode: "increase" | "set" | "decrease"; quantity: number }>
  | Readonly<{ kind: "change_variant"; item: ReaderItem; attributes: readonly AttributeChoice[]; price: StatedPrice | null }>
  | Readonly<{ kind: "set_price"; item: ReaderItem; price: StatedPrice }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "variant_only" }>
  | Readonly<{ kind: "variant_for_pendings"; pendings: readonly [ReadingRef, ReadingRef, ...ReadingRef[]] }>
  | Readonly<{ kind: "not_allowed" }>
  /** The buyer wants to pay now or asks to be sent something to pay. */
  | Readonly<{ kind: "payment_request" }>
  /** An action the reader returned incomplete or inconsistent for its kind; the check reports it as `invalid_action` (`unknown_reference`) and the rest of the answer still applies. */
  | Readonly<{ kind: "malformed" }>;

export type ReaderAnswer =
  /** At most 10 actions are applied; moreActions says the message asked for more. */
  | Readonly<{ kind: "actions"; actions: readonly [ReaderAction, ...ReaderAction[]]; moreActions: boolean }>
  | Readonly<{ kind: "no_intent" }>
  | Readonly<{ kind: "doubt" }>;

/** At most this many actions of one answer are checked and applied; the rest are reported. */
export const maxReaderActions = 10;

/**
 * What a product photo asks without reading: each shown product with its QR attributes. The quantity is left unstated:
 * it is ×1 only when the add or draft is new, and an existing pending of that product keeps its own quantity.
 */
export function fixedShownAnswer(context: ChatReadingContext): ReaderAnswer {
  const [first, ...rest] = context.products.filter((product) => product.shown).map((product): ReaderAction => ({
    kind: "add", product: { kind: "ref", ref: product.ref }, attributes: qrChoices(product), quantity: null, price: null }));
  return first ? { kind: "actions", actions: [first, ...rest], moreActions: false } : { kind: "no_intent" };
}

const qrChoices = (product: ReadingProduct): readonly AttributeChoice[] => {
  const variant = product.shownVariantId ? product.variants.find((candidate) => candidate.variantId === product.shownVariantId) : undefined;
  return Object.entries(variant?.variantAttributes ?? {}).map(([name, value]) => ({ name, value }));
};

/** The QR label's values first, so what the message names replaces them. */
const choicesFor = (product: ReadingProduct, attributes: readonly AttributeChoice[]): readonly AttributeChoice[] => [...qrChoices(product), ...attributes];

type World = Readonly<{
  context: ChatReadingContext;
  products: ReadonlyMap<ReadingRef, ReadingProduct>;
  byProductId: ReadonlyMap<ProductId, ReadingProduct>;
  items: ReadonlyMap<ReadingRef, ReadingItem>;
  pendings: ReadonlyMap<ReadingRef, ChatPending>;
}>;

/** The pending an action advances, resolved against the pendings as they were before the message. */
type PendingTarget =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "one"; pending: ChatPending }>
  | Readonly<{ kind: "several"; pendings: readonly ChatPending[] }>;

type AddedProduct =
  | Readonly<{ kind: "product"; product: ReadingProduct }>
  | Readonly<{ kind: "doubt"; products: readonly [ReadingProduct, ReadingProduct, ...ReadingProduct[]] }>
  | Readonly<{ kind: "other"; reader: Extract<ReaderProduct, { kind: "not_in_catalog" | "unnamed" }> | { kind: "unknown" } }>;

/** The reading knows no order: `applyChatActions` fills `orderId` of these reports from the open target. */
const report = (outcome: ReportOutcome): ResolvedChatAction => ({ kind: "report", outcome });
const invalid = (reason: Extract<ChatMessageOutcome, { kind: "invalid_action" }>["reason"]): ResolvedChatAction => report({ kind: "invalid_action", orderId: null, reason });
const textIdentification = (productId: ProductId): ProductIdentification => ({ method: "text", productId, confidence: null });
const identificationOf = (product: ReadingProduct): ProductIdentification => product.identification ?? textIdentification(product.productId);
const changeKinds: ReadonlySet<ReaderAction["kind"]> = new Set(["add", "complete_pending", "remove", "change_quantity", "change_variant", "set_price"]);

/** A stated quantity must be a whole number from 1; null means the reader did not state one. */
const wholeQuantity = (quantity: number | null): boolean => quantity === null || (Number.isInteger(quantity) && quantity >= 1);

/**
 * Turns the reader's answer into resolved actions against the products, items and pendings it was given. Pure: no reader value
 * reaches the order except through a catalog variant, and every failed check is a report that leaves the rest of the message applied.
 */
export function checkReaderAnswer(answer: ReaderAnswer, context: ChatReadingContext, options: Readonly<{ captionDoubt: boolean }>): readonly [ResolvedChatAction, ...ResolvedChatAction[]] {
  if (answer.kind === "no_intent") return context.kind === "photo_product" ? shownOnly(context, false) : [report({ kind: "no_intent" })];
  if (answer.kind === "doubt") return context.kind === "photo_product" ? shownOnly(context, true) : [report({ kind: "reader_doubt", orderId: null })];
  const photoAnswer = context.kind === "photo_product" ? withShownProducts(answer, context) : answer;
  const world: World = { context, products: new Map(context.products.map((product) => [product.ref, product])), byProductId: new Map(context.products.map((product) => [product.productId, product])),
    items: new Map(context.items.map((item) => [item.ref, item])), pendings: new Map(context.pendings.map((entry) => [entry.ref, entry.pending])) };
  const actions = photoAnswer.actions.slice(0, maxReaderActions);
  const targets = actions.map((action) => pendingTargetOf(action, world));
  const claims = new Map<ChatPendingId, number>();
  for (const target of targets) if (target.kind === "one") claims.set(target.pending.id, (claims.get(target.pending.id) ?? 0) + 1);
  let imageReported = false;
  const resolved = actions.flatMap((action, index): readonly ResolvedChatAction[] => {
    if (context.kind === "photo_not_product" && changeKinds.has(action.kind)) {
      if (imageReported) return [];
      imageReported = true;
      return [report({ kind: "image_with_request" })];
    }
    const target = targets[index] ?? { kind: "none" as const };
    const shared = target.kind === "one" && (claims.get(target.pending.id) ?? 0) > 1;
    return resolveAction(action, target, shared, world);
  });
  if (photoAnswer.moreActions || photoAnswer.actions.length > maxReaderActions) resolved.push(invalid("too_many_actions"));
  if (options.captionDoubt) for (const product of context.products) if (product.shown) resolved.push({ kind: "caption_doubt", productId: product.productId, identification: product.identification });
  const [first, ...rest] = resolved;
  return first ? [first, ...rest] : [report({ kind: "no_intent" })];
}

/** What a product photo does when its caption adds nothing: the shown products follow the photo rules. */
function shownOnly(context: ChatReadingContext, captionDoubt: boolean): readonly [ResolvedChatAction, ...ResolvedChatAction[]] {
  const fixed = fixedShownAnswer(context);
  return fixed.kind === "actions" ? checkReaderAnswer(fixed, context, { captionDoubt }) : [report({ kind: "no_intent" })];
}

type ActionsAnswer = Extract<ReaderAnswer, { kind: "actions" }>;
type QuantityChange = Extract<ReaderAction, { kind: "change_quantity" }>;
const isUnnamedChange = (action: ReaderAction): action is QuantityChange => action.kind === "change_quantity" && action.target.kind === "unnamed";

/**
 * A product photo whose caption only asks what the photo never does (a payment, something not allowed, «listo», an unnamed quantity) still
 * adds or leaves pending the shown product: the shown answer goes first. An unnamed total with one shown product is that product's
 * quantity; any other unnamed change is an unnamed add, never a change to another item.
 */
function withShownProducts(answer: ActionsAnswer, context: ChatReadingContext): ActionsAnswer {
  const fixed = fixedShownAnswer(context);
  const onlyExtras = answer.actions.every((action) => action.kind === "payment_request" || action.kind === "not_allowed" || action.kind === "ready" || isUnnamedChange(action));
  if (fixed.kind !== "actions" || !onlyExtras) return answer;
  const [shown, ...otherShown] = fixed.actions;
  const total = fixed.actions.length === 1 ? answer.actions.findIndex((action) => isUnnamedChange(action) && action.mode === "set") : -1;
  const totalAction = answer.actions[total];
  const first = shown.kind === "add" && totalAction?.kind === "change_quantity" ? { ...shown, quantity: totalAction.quantity } : shown;
  const extras = answer.actions.flatMap((action, index): ReaderAction[] => (index === total ? [] : isUnnamedChange(action) ? [{ kind: "add", product: { kind: "unnamed" }, attributes: [], quantity: null, price: null }] : [action]));
  return { kind: "actions", actions: [first, ...otherShown, ...extras], moreActions: answer.moreActions };
}

/** A product named twice in an answer, or once with two readings, is one product: pendings of it are searched once. */
function addedProductOf(product: ReaderProduct, world: World): AddedProduct {
  if (product.kind === "not_in_catalog" || product.kind === "unnamed") return { kind: "other", reader: product };
  if (product.kind === "ref") {
    const found = world.products.get(product.ref);
    return found ? { kind: "product", product: found } : { kind: "other", reader: { kind: "unknown" } };
  }
  const named = product.refs.map((ref) => world.products.get(ref));
  const listed = named.filter((found): found is ReadingProduct => found !== undefined);
  if (listed.length < named.length) return { kind: "other", reader: { kind: "unknown" } };
  const unique = listed.filter((found, index) => listed.findIndex((other) => other.productId === found.productId) === index);
  // A product that is not sellable and has the name of a sellable one is its twin, never a doubt.
  const sellableNames = new Set(unique.filter((found) => found.sellable).map((found) => productNameKey(found.name)));
  const distinct = unique.filter((found) => found.sellable || !sellableNames.has(productNameKey(found.name)));
  const [first, second, ...rest] = distinct;
  if (!first) return { kind: "other", reader: { kind: "unknown" } };
  if (!second) return { kind: "product", product: first };
  const withoutPending = distinct.filter((found) => !hasVariantPending(found, world));
  if (withoutPending.length === distinct.length) return { kind: "doubt", products: [first, second, ...rest] };
  const [remaining, other, ...others] = withoutPending;
  if (!remaining) return { kind: "product", product: first };
  return other ? { kind: "doubt", products: [remaining, other, ...others] } : { kind: "product", product: remaining };
}

const hasVariantPending = (product: ReadingProduct, world: World): boolean =>
  [...world.pendings.values()].some((pending) => pending.subject.kind === "variant" && pending.subject.productId === product.productId);

function pendingTargetOf(action: ReaderAction, world: World): PendingTarget {
  if (action.kind === "complete_pending") {
    const pending = world.pendings.get(action.pending);
    return pending ? { kind: "one", pending } : { kind: "none" };
  }
  if (action.kind !== "add") return { kind: "none" };
  const added = addedProductOf(action.product, world);
  return added.kind === "product" ? matchPendings(added.product, choicesFor(added.product, action.attributes), world) : { kind: "none" };
}

/** Pendings of a product: its variant pendings and the doubtful ones that list it. */
function matchPendings(product: ReadingProduct, choices: readonly AttributeChoice[], world: World): PendingTarget {
  const mine = [...world.pendings.values()].filter((pending) => (pending.subject.kind === "variant" ? pending.subject.productId === product.productId : pending.subject.candidates.includes(product.productId)));
  const [only, ...others] = mine;
  if (!only) return { kind: "none" };
  if (others.length === 0) return { kind: "one", pending: only };
  const fitting = mine.filter((pending) => !conflictsWithKnown(pending.known, choices));
  const [fit, ...moreFitting] = fitting;
  if (fit && moreFitting.length === 0) return { kind: "one", pending: fit };
  if (fit) return { kind: "several", pendings: fitting };
  return { kind: "one", pending: mine.reduce((latest, pending) => (pending.lastChangedAt.getTime() >= latest.lastChangedAt.getTime() ? pending : latest)) };
}

function resolveAction(action: ReaderAction, target: PendingTarget, shared: boolean, world: World): readonly ResolvedChatAction[] {
  switch (action.kind) {
    case "not_allowed": return [report({ kind: "request_not_allowed", orderId: null })];
    // `applyChatActions` fills the order and what the chat still waits for.
    case "payment_request": return [report({ kind: "payment_requested", order: { kind: "none" }, productIds: [], unnamed: 0 })];
    case "malformed": return [invalid("malformed")];
    case "ready": return [{ kind: "ready" }];
    case "variant_only": return [report({ kind: "variant_only" })];
    case "decline_shown": return [];
    case "decline_pending": {
      const pending = world.pendings.get(action.pending);
      return [pending ? { kind: "decline_pending", pendingId: pending.id } : invalid("unknown_reference")];
    }
    case "variant_for_pendings": {
      const named = action.pendings.map((ref) => world.pendings.get(ref));
      const pendings = named.filter((pending): pending is ChatPending => pending !== undefined);
      return [pendings.length < named.length ? invalid("unknown_reference") : report({ kind: "variant_for_several_pendings", ...describePendings(pendings) })];
    }
    case "remove": return [{ kind: "remove", target: itemTarget(action.item, world), amount: action.amount }];
    case "change_quantity": return changeQuantity(action, world);
    case "set_price": {
      const item = readingItem(action.item, world);
      return [{ kind: "set_mentioned_price", target: itemTarget(action.item, world), price: item ? mentionedPriceOf(action.price, item.quantity, item.unitPrice) : null }];
    }
    case "change_variant": return changeVariant(action, world);
    case "add": return resolveAdd(action, target, shared, world);
    case "complete_pending": return completePending(action, target, shared, world);
  }
}

function itemTarget(item: ReaderItem, world: World): ItemTarget {
  if (item.kind === "unnamed") return { kind: "unnamed" };
  const found = item.kind === "ref" ? world.items.get(item.ref) : undefined;
  return found ? { kind: "variant", variantId: found.variantId } : { kind: "unclear", namedItem: true, namedProductId: null };
}

/** The listed item a reader item points to; «ese» points to the only item. */
const readingItem = (item: ReaderItem, world: World): ReadingItem | null =>
  item.kind === "ref" ? world.items.get(item.ref) ?? null : item.kind === "unnamed" && world.context.items.length === 1 ? world.context.items[0] ?? null : null;

/** The photo just sent: only a text is ever read against it, so a caption never changes what the previous photo left. */
const photoLeftOf = (world: World): PhotoLeft | null => (world.context.kind === "text" ? world.context.photoJustSent : null);
const unnamedAdd = (): ResolvedChatAction => report({ kind: "unnamed_add" });

function changeQuantity(action: Extract<ReaderAction, { kind: "change_quantity" }>, world: World): readonly ResolvedChatAction[] {
  const { target, mode, quantity } = action;
  const whole = Number.isInteger(quantity) && (mode === "set" ? quantity >= 0 : quantity >= 1);
  if (!whole) return [invalid("quantity_not_whole")];
  if (target.kind === "pending") {
    const pending = world.pendings.get(target.ref);
    if (!pending) return [invalid("unknown_reference")];
    const namedProductId = pending.subject.kind === "variant" ? pending.subject.productId : null;
    return [{ kind: "change_pending_quantity", pendingId: pending.id, mode, quantity, otherwise: report({ kind: "unclear_item", orderId: null, namedItem: true, namedProductId }) }];
  }
  if (target.kind === "unnamed") {
    // A product photo's caption never reaches the only-item rule: its unnamed total was given to the shown product before.
    if (world.context.kind === "photo_product") return [unnamedAdd()];
    const left = photoLeftOf(world);
    if (left) return mode === "set" ? [markedQuantity(left, quantity)] : [unnamedAdd()];
  }
  const lineTarget = itemTarget(target, world);
  if (mode === "increase") return [{ kind: "increase_quantity", target: lineTarget, quantity: quantity as PositiveInteger }];
  if (mode === "decrease") return [{ kind: "lower_quantity", target: lineTarget, quantity: quantity as PositiveInteger }];
  return [{ kind: "set_quantity", target: lineTarget, quantity }];
}

/** The quantity of what the photo just sent left, which falls back to an unnamed add when it is no longer that. */
const markedQuantity = (left: PhotoLeft, quantity: number): ResolvedChatAction => left.kind === "pending"
  ? { kind: "change_pending_quantity", pendingId: left.pendingId, mode: "set", quantity, otherwise: unnamedAdd() }
  : { kind: "set_marked_item_quantity", orderId: left.orderId, variantId: left.variantId, expectedQuantity: left.quantity, quantity, otherwise: unnamedAdd() };

function changeVariant(action: Extract<ReaderAction, { kind: "change_variant" }>, world: World): readonly ResolvedChatAction[] {
  const item = readingItem(action.item, world);
  const unclear = (productId: ProductId | null) => [report({ kind: "unclear_item", orderId: null, namedItem: action.item.kind === "ref", namedProductId: productId })];
  if (!item) return unclear(null);
  const product = item.productId ? world.byProductId.get(item.productId) : undefined;
  if (!product) return unclear(item.productId);
  if (!product.sellable) return [report({ kind: "product_not_available", productId: product.productId })];
  const resolution = resolveVariant(product, item.variantAttributes, action.attributes);
  const target = itemTarget(action.item, world);
  if (resolution.kind === "resolved") {
    return [{ kind: "change_variant", target, to: { kind: "resolved", item: resolution.item }, mentionedPrice: action.price ? mentionedPriceOf(action.price, item.quantity, resolution.item.unitPrice) : null }];
  }
  return [{ kind: "change_variant", target, to: { kind: resolution.kind === "open" ? "missing" : "not_available", productId: product.productId }, mentionedPrice: null }];
}

/** The action for a product that has no pending to advance: an item, a new pending, or the reason it cannot be either. */
function freshAdd(product: ReadingProduct, choices: readonly AttributeChoice[], quantity: number, price: StatedPrice | null): ResolvedChatAction {
  if (!product.sellable) return report({ kind: "product_not_available", productId: product.productId });
  const identification = identificationOf(product);
  const resolution = resolveVariant(product, {}, choices);
  if (resolution.kind === "resolved") {
    return { kind: "add", item: resolution.item, quantity: quantity as PositiveInteger, mentionedPrice: price ? mentionedPriceOf(price, quantity, resolution.item.unitPrice) : null, identification };
  }
  return { kind: "draft_pending", draft: { subject: { kind: "variant", productId: product.productId }, known: resolution.known, quantity, price: price ? pendingPriceOf(price, quantity, product) : null,
    problem: resolution.kind === "open" ? "variant_missing" : "variant_not_available", identification } };
}

function resolveAdd(action: Extract<ReaderAction, { kind: "add" }>, target: PendingTarget, shared: boolean, world: World): readonly ResolvedChatAction[] {
  if (!wholeQuantity(action.quantity)) return [invalid("quantity_not_whole")];
  const added = addedProductOf(action.product, world);
  const photo = world.context.kind === "photo_product";
  if (added.kind === "other") {
    if (added.reader.kind === "unnamed") return [report({ kind: "unnamed_add" })];
    if (added.reader.kind === "unknown") return [invalid("unknown_reference")];
    return [photo ? invalid("not_the_shown_product") : report({ kind: "not_identified", source: "text", identification: null, silent: false })];
  }
  const quantity = action.quantity ?? 1;
  if (added.kind === "doubt") return [photo ? invalid("not_the_shown_product") : doubtfulDraft(added.products, action, quantity)];
  const { product } = added;
  const choices = choicesFor(product, action.attributes);
  const fresh = photo && !product.shown ? invalid("not_the_shown_product") : freshAdd(product, choices, quantity, action.price);
  if (target.kind === "several") return [report({ kind: "variant_for_several_pendings", ...describePendings(target.pendings) })];
  if (target.kind === "none") return [fresh];
  const request: AdvanceRequest = { pendingId: target.pending.id, mode: shared ? "assign" : "total", product, productId: product.productId, identification: identificationOf(product),
    values: choices, quantity: shared ? quantity : action.quantity, price: action.price };
  return [{ kind: "advance_pending", request, otherwise: fresh }];
}

/** Two to four candidates the reader could not tell apart; only the values every candidate offers are kept. */
function doubtfulDraft(products: readonly [ReadingProduct, ReadingProduct, ...ReadingProduct[]], action: Extract<ReaderAction, { kind: "add" }>, quantity: number): ResolvedChatAction {
  const candidates = products.slice(0, maxPendingCandidates).map((product) => product.productId) as unknown as readonly [ProductId, ProductId, ...ProductId[]];
  const offered = (product: ReadingProduct, choice: AttributeChoice) => product.attributes.find((attribute) => normalizeValue(attribute.name) === normalizeValue(choice.name))
    ?.values.find((value) => normalizeValue(value) === normalizeValue(choice.value));
  const known: Record<string, string> = {};
  for (const choice of action.attributes) {
    const attribute = products[0].attributes.find((candidate) => normalizeValue(candidate.name) === normalizeValue(choice.name));
    const value = offered(products[0], choice);
    if (attribute && value !== undefined && products.every((product) => offered(product, choice) !== undefined)) known[attribute.name] = value;
  }
  return { kind: "draft_pending", draft: { subject: { kind: "product", candidates }, known, quantity, price: action.price ? pendingPriceOf(action.price, quantity, products[0]) : null, problem: "not_clear", identification: null } };
}

function completePending(action: Extract<ReaderAction, { kind: "complete_pending" }>, target: PendingTarget, shared: boolean, world: World): readonly ResolvedChatAction[] {
  if (target.kind !== "one" || !wholeQuantity(action.quantity)) return [target.kind !== "one" ? invalid("unknown_reference") : invalid("quantity_not_whole")];
  const { pending } = target;
  if (action.product === null && action.attributes.length === 0 && action.quantity !== null) {
    // Only a quantity: the units of what the photo just sent left, otherwise an unnamed add that never grows a pending.
    const left = photoLeftOf(world);
    return [left?.kind === "pending" && left.pendingId === pending.id ? markedQuantity(left, action.quantity) : unnamedAdd()];
  }
  const named = action.product === null ? undefined : world.products.get(action.product);
  if (action.product !== null && !named) return [invalid("unknown_reference")];
  const chosen = named ?? ownProduct(pending, world);
  if (chosen === "ambiguous") return [report({ kind: "variant_only" })];
  const productId = chosen?.productId ?? (pending.subject.kind === "variant" ? pending.subject.productId : pending.subject.candidates[0]);
  const request: AdvanceRequest = { pendingId: pending.id, mode: "assign", product: chosen, productId, identification: chosen ? identificationOf(chosen) : textIdentification(productId),
    values: action.attributes, quantity: shared ? action.quantity ?? 1 : action.quantity, price: action.price };
  return [{ kind: "advance_pending", request, otherwise: named ? freshAdd(named, action.attributes, action.quantity ?? 1, action.price) : report({ kind: "variant_only" }) }];
}

/** The product a pending waits for: its own, the only one left of a doubtful pending's candidates, null when deleted. */
function ownProduct(pending: ChatPending, world: World): ReadingProduct | null | "ambiguous" {
  if (pending.subject.kind === "variant") return world.byProductId.get(pending.subject.productId) ?? null;
  const present = pending.subject.candidates.flatMap((productId) => world.byProductId.get(productId) ?? []);
  const [only, ...rest] = present;
  if (!only) return null;
  return rest.length === 0 ? only : "ambiguous";
}
