import type { Currency } from "@shared/money";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatMessageOutcome, ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import { maxChatPendings, type ChatPending, type ChatPendingId, type ChatPendings, type PendingPrice, type PendingSubject } from "@core/src/features/orders/domain/chat-pendings";
import { mentionedPriceOf, statedMoney, type MentionedPrice, type StatedPrice } from "@core/src/features/orders/domain/mentioned-price";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import { notAvailableReason } from "@core/src/features/orders/domain/product-availability";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

/** Catalog attribute names and values. */
export type KnownValues = Readonly<Record<string, string>>;
export type AttributeChoice = Readonly<{ name: string; value: string }>;

/** Compares reader values with catalog values ignoring case and accents. Character normalization only, never morphology. */
export const normalizeValue = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export type VariantResolution =
  | Readonly<{ kind: "resolved"; item: CatalogItem; known: KnownValues }>
  /** Attributes still vary among the sellable variants that fit. */
  | Readonly<{ kind: "open"; known: KnownValues }>
  /** A value or attribute name the product does not offer, or a combination it does not sell. `known` keeps what does exist. */
  | Readonly<{ kind: "not_offered"; known: KnownValues }>;

/**
 * Filters the sellable variants by the values. `base` (a pending's values, a QR label) is leniently kept; the `choices` are the message's words
 * and any that the catalog does not offer make the whole resolution `not_offered`. Later values replace earlier ones of the same attribute.
 */
export function resolveVariant(product: ProductForReading, base: KnownValues, choices: readonly AttributeChoice[]): VariantResolution {
  let known: KnownValues = {};
  const put = (name: string, value: string): boolean => {
    const attribute = product.attributes.find((candidate) => normalizeValue(candidate.name) === normalizeValue(name));
    const catalogValue = attribute?.values.find((candidate) => normalizeValue(candidate) === normalizeValue(value));
    if (!attribute || catalogValue === undefined) return false;
    const next = { ...known, [attribute.name]: catalogValue };
    if (!matching(product, next).length) return false;
    known = next;
    return true;
  };
  for (const [name, value] of Object.entries(base)) put(name, value);
  const offered = choices.map((choice) => put(choice.name, choice.value)).every(Boolean);
  const variants = matching(product, known);
  if (offered && variants.length === 1 && variants[0]) return { kind: "resolved", item: variants[0], known };
  return offered ? { kind: "open", known } : { kind: "not_offered", known };
}

const matching = (product: ProductForReading, known: KnownValues): readonly CatalogItem[] =>
  product.variants.filter((variant) => Object.entries(known).every(([name, value]) => variant.variantAttributes[name] === value));

/** True when a message's values contradict what a pending already knows. */
export function conflictsWithKnown(known: KnownValues, choices: readonly AttributeChoice[]): boolean {
  return choices.some((choice) => Object.entries(known).some(([name, value]) => normalizeValue(name) === normalizeValue(choice.name) && normalizeValue(value) !== normalizeValue(choice.value)));
}

export type PendingAdd = Readonly<{ item: CatalogItem; quantity: PositiveInteger; mentionedPrice: MentionedPrice | null; identification: ProductIdentification }>;
export type PendingStep = Readonly<{ set: ChatPendings; outcomes: readonly ChatMessageOutcome[]; adds: readonly PendingAdd[] }>;

export type PendingDraft = Readonly<{
  subject: PendingSubject;
  known: KnownValues;
  quantity: number;
  price: PendingPrice | null;
  problem: "variant_missing" | "variant_not_available" | "not_clear";
  identification: ProductIdentification | null;
}>;

/**
 * The one request for «a later message names a pending's product». `total`: the quantity is the new total wanted (an add);
 * `assign`: it is the units of the pending this answer covers, null meaning all of them (a completion).
 */
export type AdvanceRequest = Readonly<{
  pendingId: ChatPendingId;
  mode: "total" | "assign";
  /** Null when the product was deleted. */
  product: ProductForReading | null;
  productId: ProductId;
  identification: ProductIdentification;
  values: readonly AttributeChoice[];
  quantity: number | null;
  price: StatedPrice | null;
}>;

export type TransitionEnv = Readonly<{
  now: Date;
  maxItemQuantity: number;
  newPendingId: () => ChatPendingId;
  sourceMessageId: ChatMessageId;
  /** Units of the variant already in the order, so a completion never adds past the limit. */
  existingQuantity: (variantId: VariantId) => number;
}>;

const stepOf = (set: ChatPendings, outcomes: readonly ChatMessageOutcome[] = [], adds: readonly PendingAdd[] = []): PendingStep => ({ set, outcomes, adds });
const replace = (set: ChatPendings, pending: ChatPending): ChatPending[] => set.pendings.map((candidate) => (candidate.id === pending.id ? pending : candidate));
const currencyOf = (product: ProductForReading): Currency | null => product.variants[0]?.unitPrice.currency ?? null;

/** Joins every alive pending without an order to the one the message has or creates. */
export function attachOrderless(set: ChatPendings, orderId: OrderId, now: Date): ChatPendings {
  if (set.pendings.every((pending) => pending.order)) return set;
  return { ...set, pendings: set.pendings.map((pending) => (pending.order ? pending : { ...pending, order: { orderId, attachedAt: now } })) };
}

export function declinePending(set: ChatPendings, pendingId: ChatPendingId): PendingStep {
  if (!set.pendings.some((pending) => pending.id === pendingId)) return stepOf(set);
  return stepOf({ ...set, pendings: set.pendings.filter((pending) => pending.id !== pendingId) }, [{ kind: "pending_ended", pendingId, reason: "declined" }]);
}

/** The price a buyer stated, kept with the quantity it was stated for. */
export function pendingPriceOf(stated: StatedPrice, forQuantity: number, product: ProductForReading): PendingPrice | null {
  const currency = currencyOf(product);
  const amount = currency ? statedMoney(stated, currency) : null;
  return amount && Number.isInteger(forQuantity) && forQuantity >= 1 ? { amount, per: stated.per, forQuantity: forQuantity as PositiveInteger } : null;
}

/** Creates the pending of a product that had none before the message. An 11th ends the least recently changed one. */
export function draftPending(set: ChatPendings, draft: PendingDraft, env: TransitionEnv): PendingStep {
  if (draft.quantity > env.maxItemQuantity) {
    const productId = draft.subject.kind === "variant" ? draft.subject.productId : draft.subject.candidates[0];
    return stepOf(set, [{ kind: "quantity_above_limit", productId, identification: draft.identification }]);
  }
  const id = env.newPendingId();
  const created: ChatPending = { id, subject: draft.subject, known: draft.known, quantity: draft.quantity as PositiveInteger, price: draft.price, order: null,
    lastChangedAt: env.now, sourceMessageId: env.sourceMessageId, requestId: id };
  const problem: ChatMessageOutcome = draft.subject.kind === "product" ? { kind: "not_clear", productIds: draft.subject.candidates, silent: false }
    : { kind: draft.problem === "variant_not_available" ? "variant_not_available" : "variant_missing", productId: draft.subject.productId, identification: draft.identification };
  const limited = enforceLimit({ ...set, pendings: [...set.pendings, created] }, [id]);
  return stepOf(limited.set, [{ kind: "pending_created", pendingId: id }, problem, ...limited.outcomes]);
}

/** Keeps at most `maxChatPendings`: the least recently changed other pending ends silently. */
function enforceLimit(set: ChatPendings, keep: readonly ChatPendingId[]): Readonly<{ set: ChatPendings; outcomes: readonly ChatMessageOutcome[] }> {
  const pendings = [...set.pendings];
  const outcomes: ChatMessageOutcome[] = [];
  while (pendings.length > maxChatPendings) {
    const oldest = pendings.filter((pending) => !keep.includes(pending.id)).reduce<ChatPending | null>((first, pending) => (!first || pending.lastChangedAt.getTime() < first.lastChangedAt.getTime() ? pending : first), null);
    if (!oldest) break;
    pendings.splice(pendings.indexOf(oldest), 1);
    outcomes.push({ kind: "pending_ended", pendingId: oldest.id, reason: "limit" });
  }
  return { set: { ...set, pendings }, outcomes };
}

/**
 * The one rule for a later message that names a pending's product. No unit of a pending is ever dropped: the covered units become items
 * or stay as a pending, and the units the answer does not cover stay as the remainder.
 */
export function advancePending(set: ChatPendings, request: AdvanceRequest, env: TransitionEnv): PendingStep {
  const pending = set.pendings.find((candidate) => candidate.id === request.pendingId);
  if (!pending) return stepOf(set);
  const { product } = request;
  if (!product?.sellable) {
    const ended = set.pendings.filter((candidate) => candidate.id !== pending.id);
    return stepOf({ ...set, pendings: ended }, [{ kind: "pending_ended", pendingId: pending.id, reason: "product_not_available" }, { kind: "product_not_available", productId: product ? request.productId : null, reason: notAvailableReason(product ?? null) }]);
  }
  const covered = request.quantity ?? pending.quantity;
  const partial = request.mode === "assign" && request.quantity !== null && request.quantity < pending.quantity;
  if (covered > env.maxItemQuantity) return stepOf(set, [{ kind: "quantity_above_limit", productId: request.productId, identification: request.identification }]);
  const resolution = resolveVariant(product, pending.known, request.values);
  const stated = request.price ? pendingPriceOf(request.price, covered, product) : null;
  const price = stated ?? pending.price;
  if (resolution.kind === "resolved") return completePending(set, pending, request, resolution.item, covered, partial, price, env);
  const subject: PendingSubject = { kind: "variant", productId: request.productId };
  const changed: ChatPending = { ...pending, subject, known: resolution.known, quantity: covered as PositiveInteger, price, lastChangedAt: env.now };
  const notOffered: ChatMessageOutcome[] = resolution.kind === "not_offered" ? [{ kind: "variant_not_available", productId: request.productId, identification: request.identification }] : [];
  if (!partial) return stepOf({ ...set, pendings: replace(set, changed) }, [{ kind: "pending_updated", pendingId: pending.id }, ...notOffered]);
  if (resolution.kind === "not_offered") return stepOf(set, notOffered);
  const part: ChatPending = { ...changed, id: env.newPendingId(), price: stated ?? pending.price };
  const remainder: ChatPending = { ...pending, quantity: (pending.quantity - covered) as PositiveInteger, lastChangedAt: env.now };
  const limited = enforceLimit({ ...set, pendings: [...replace(set, remainder), part] }, [pending.id, part.id]);
  return stepOf(limited.set, [{ kind: "pending_split", pendingId: pending.id, newPendingId: part.id }, ...limited.outcomes]);
}

/** The covered units become one item. A lot price goes whole on that item and leaves every pending of its request. */
function completePending(set: ChatPendings, pending: ChatPending, request: AdvanceRequest, item: CatalogItem, covered: number, partial: boolean,
  price: PendingPrice | null, env: TransitionEnv): PendingStep {
  if (covered + env.existingQuantity(item.variantId) > env.maxItemQuantity) {
    return stepOf(set, [{ kind: "quantity_above_limit", productId: request.productId, identification: request.identification }]);
  }
  const mentioned = price ? mentionedPriceOf({ amount: String(price.amount.amount), currency: "not_named", per: price.per }, price.forQuantity, item.unitPrice) : null;
  const lotReading = mentioned !== null && mentioned.units > 1;
  const add: PendingAdd = { item, quantity: covered as PositiveInteger, mentionedPrice: mentioned, identification: request.identification };
  const others = set.pendings.filter((candidate) => candidate.id !== pending.id)
    .map((candidate) => (lotReading && candidate.requestId === pending.requestId ? { ...candidate, price: null } : candidate));
  if (!partial) return stepOf({ ...set, pendings: others }, [{ kind: "pending_completed", pendingId: pending.id }], [add]);
  const remainder: ChatPending = { ...pending, quantity: (pending.quantity - covered) as PositiveInteger, lastChangedAt: env.now, price: lotReading ? null : pending.price };
  return stepOf({ ...set, pendings: set.pendings.map((candidate) => (candidate.id === pending.id ? remainder : others.find((other) => other.id === candidate.id) ?? candidate)) },
    [{ kind: "pending_updated", pendingId: pending.id }], [add]);
}

/** The products a set of pendings still waits for, named once, and how many cannot be named (doubtful or deleted). */
export function describePendings(pendings: readonly ChatPending[]): Readonly<{ productIds: readonly ProductId[]; unnamed: number }> {
  const productIds = [...new Set(pendings.flatMap((pending) => (pending.subject.kind === "variant" ? [pending.subject.productId] : [])))];
  return { productIds, unnamed: pendings.filter((pending) => pending.subject.kind === "product").length };
}
