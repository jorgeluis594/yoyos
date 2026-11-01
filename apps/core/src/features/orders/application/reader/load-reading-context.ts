import { ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import type { RecentChatMessage, RecentChatMessagesQuery } from "@core/src/features/chats/composition";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import type { StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import { pendingLife, type ChatPending, type ChatPendings, type LastIncomingPhoto, type PendingLife } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { capContextText, fitReadingInput, type BudgetCut, type ReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { ContextMessageRef, ItemRef, PendingRef, ReadingContextMessage, ReadingEndedPending, ReadingInput, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/reader/readings";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
export type LoadReadingContextError = PersistenceError | InvalidStoredData;

/** The message the reader reads: its times anchor the context window (the sent time, or the received time when there is none). */
export type ReadingMessage = ChatSourceMessage & Readonly<{ sentAt: Date | null; receivedAt: Date }>;

export type LoadReadingContextDependencies = Readonly<{
  findRecentChatMessages: (query: RecentChatMessagesQuery) => Promise<Result<readonly RecentChatMessage[], LoadReadingContextError>>;
  /** The stored masks of the messages; a message without one is absent. */
  findMaskedTexts: (messageIds: readonly ChatMessageId[]) => Promise<Result<ReadonlyMap<ChatMessageId, string>, LoadReadingContextError>>;
  findOutcome: (messageId: ChatMessageId) => Promise<Result<StoredChatMessageOutcome | null, LoadReadingContextError>>;
  findChatOrdersOpenedSince: (chatId: ChatId, since: Date) => Promise<Result<readonly OrderAggregate[], LoadReadingContextError>>;
  /** The currency of the company's prices, or null when the company has none on record. */
  findShopCurrency: () => Promise<Result<Currency | null, LoadReadingContextError>>;
  /** The catalog products of the pendings, named to the stages with the values their variants still leave open. */
  findProductsForReading: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], LoadReadingContextError>>;
  clock: () => Date;
  pendingTtlMs: number;
  budgets: ReadingBudgets;
}>;

export type ReadingContextData = Readonly<{
  /** The chat's order, as the caller read it. */
  target: ChatOrderTarget;
  /** The chat's pendings split into those alive and those that ended. */
  life: PendingLife;
  /** The bounded input of the three stages. */
  input: ReadingInput;
  /** The message each context ref stands for, only for the context the input keeps. */
  contextMessageIds: ReadonlyMap<ContextMessageRef, ChatMessageId>;
  /** The stored masks of the kept context messages. */
  masks: ReadonlyMap<ChatMessageId, string>;
  /** The outcome of the latest incoming photo of the window, kept or cut from the input. */
  photoOutcome: Readonly<{ ref: ContextMessageRef; messageId: ChatMessageId; outcome: StoredChatMessageOutcome }> | null;
  cut: BudgetCut;
}>;

const hasPhoto = (message: RecentChatMessage) => message.type === "image" && message.direction === "incoming";

function contextOf(oldestFirst: readonly RecentChatMessage[], masks: ReadonlyMap<ChatMessageId, string>, maxChars: number): readonly ReadingContextMessage[] {
  return oldestFirst.map((message, index) => {
    const text = message.text ?? message.caption;
    return { ref: `M${index + 1}` as ContextMessageRef, direction: message.direction, kind: message.type, text: text === null ? null : capContextText(text, maxChars),
      sentAt: message.sentAt, masked: masks.has(message.id) };
  });
}

function itemsOf(target: ChatOrderTarget, maxItems: number): readonly ReadingItem[] {
  if (target.kind !== "open") return [];
  return target.order.items.slice(0, maxItems).map((item, index) => ({ ref: `I${index + 1}` as ItemRef, itemId: item.id, productId: target.productIds.get(item.variantId) ?? null,
    variantId: item.variantId, productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity }));
}

/** The attributes a pending on one product still lacks, each with the values of the sellable variants that fit what is known. */
function missingOf(product: ProductForReading, known: Readonly<Record<string, string>>): ReadingPending["missing"] {
  const fitting = product.variants.filter(({ variantAttributes }) => Object.entries(known).every(([name, value]) => variantAttributes[name] === undefined || variantAttributes[name] === value));
  return product.attributes.filter(({ name }) => known[name] === undefined).flatMap(({ name }) => {
    const values = [...new Set(fitting.flatMap(({ variantAttributes }) => (variantAttributes[name] === undefined ? [] : [variantAttributes[name]])))];
    return values.length ? [{ name, values }] : [];
  });
}

function pendingsOf(alive: readonly ChatPending[], products: ReadonlyMap<ProductId, ProductForReading>): readonly ReadingPending[] {
  return alive.map((pending, index) => {
    const productIds = pending.subject.kind === "variant" ? [pending.subject.productId] : pending.subject.candidates;
    const listed = productIds.flatMap((id) => (products.has(id) ? [products.get(id)!] : []));
    const named = listed.length === productIds.length ? { productNames: listed.map(({ name }) => name) } : {};
    const missing = productIds.length === 1 && listed.length === 1 ? { missing: missingOf(listed[0]!, pending.known) } : {};
    return { ref: `Q${index + 1}` as PendingRef, pendingId: pending.id, productIds, known: pending.known, quantity: pending.quantity, doubtful: pending.doubt !== null, ...named, ...missing };
  });
}

/**
 * The pendings that ended within the context window (last changed since `since`), numbered after the alive ones;
 * the stored set holds each one until this message is applied.
 */
function endedPendingsOf(life: PendingLife, stored: readonly ChatPending[], products: ReadonlyMap<ProductId, ProductForReading>, firstNumber: number, since: Date): readonly ReadingEndedPending[] {
  const byId = new Map(stored.map((pending) => [pending.id, pending] as const));
  const recent = life.ended.flatMap(({ id, reason }) => {
    const pending = byId.get(id);
    return pending && pending.lastChangedAt >= since ? [{ pending, id, reason }] : [];
  });
  return recent.map(({ pending, id, reason }, index): ReadingEndedPending => {
    const productIds = pending.subject.kind === "variant" ? [pending.subject.productId] : pending.subject.candidates;
    const listed = productIds.flatMap((productId) => {
      const product = products.get(productId);
      return product ? [product] : [];
    });
    return { ref: `Q${firstNumber + index}` as PendingRef, pendingId: id, productIds, known: pending.known, quantity: pending.quantity,
      ...(listed.length === productIds.length ? { productNames: listed.map(({ name }) => name) } : {}), ended: reason };
  });
}

async function openedSinceOf(deps: LoadReadingContextDependencies, chatId: ChatId, pendings: ChatPendings) {
  const orderless = pendings.pendings.filter((pending) => !pending.order);
  if (!orderless.length) return ok<readonly OrderAggregate[]>([]);
  return await deps.findChatOrdersOpenedSince(chatId, new Date(Math.min(...orderless.map((pending) => pending.lastChangedAt.getTime()))));
}

/**
 * The reading input of one message: the chat's recent messages (both directions, within the window, newest `contextMessages`), their stored masks,
 * the outcome of the latest incoming photo of the window, the order lines and the alive pendings, with short refs, under the stage input budget.
 * All reads are outside the message transaction.
 */
export async function loadReadingContext(deps: LoadReadingContextDependencies, message: ReadingMessage, target: ChatOrderTarget, pendings: ChatPendings,
  photoMemory: LastIncomingPhoto | null): Promise<Result<ReadingContextData, LoadReadingContextError>> {
  const { budgets } = deps;
  const found = await deps.findRecentChatMessages({ chatId: message.chatId, anchor: message.sentAt ?? message.receivedAt, messageId: message.id,
    limit: budgets.contextMessages, windowHours: budgets.contextHours });
  if (!found.success) return found;
  const recent = [...found.data].reverse();
  const latestPhoto = [...recent].reverse().find(hasPhoto);
  const [masks, photo, openedSince, currency] = await Promise.all([
    deps.findMaskedTexts(recent.map(({ id }) => id)),
    latestPhoto ? deps.findOutcome(latestPhoto.id) : Promise.resolve(ok<StoredChatMessageOutcome | null>(null)),
    openedSinceOf(deps, message.chatId, pendings),
    deps.findShopCurrency(),
  ]);
  if (!masks.success) return masks;
  if (!photo.success) return photo;
  if (!openedSince.success) return openedSince;
  if (!currency.success) return currency;
  const pendingProductIds = [...new Set(pendings.pendings.flatMap(({ subject }) => (subject.kind === "variant" ? [subject.productId] : subject.candidates)))];
  const catalog = pendingProductIds.length ? await deps.findProductsForReading(pendingProductIds) : ok<readonly ProductForReading[]>([]);
  if (!catalog.success) return catalog;
  const life = pendingLife(pendings, { target, openedSince: openedSince.data }, deps.clock(), deps.pendingTtlMs);
  const context = contextOf(recent, masks.data, budgets.contextMessageChars);
  const current = { messageId: message.id, kind: message.imageId ? "image" : "text", text: message.text ?? message.caption ?? "" };
  const productsById = new Map(catalog.data.map((product) => [product.productId, product] as const));
  const anchor = message.sentAt ?? message.receivedAt;
  const endedPendings = endedPendingsOf(life, pendings.pendings, productsById, life.alive.length + 1, new Date(anchor.getTime() - budgets.contextHours * 3_600_000));
  const fitted = fitReadingInput({ current, context, items: itemsOf(target, budgets.maxItems), pendings: pendingsOf(life.alive, productsById), ...(endedPendings.length ? { endedPendings } : {}), photoMemory, photo: null, ...(currency.data ? { currency: currency.data } : {}) }, budgets.stageInputMaxChars);
  const idOf = new Map(context.map(({ ref }, index) => [ref, recent[index]!.id] as const));
  const kept = fitted.input.context.map(({ ref }) => [ref, idOf.get(ref)!] as const);
  const photoOutcome = latestPhoto && photo.data ? { ref: context[recent.indexOf(latestPhoto)]!.ref, messageId: latestPhoto.id, outcome: photo.data } : null;
  return ok({ target, life, input: fitted.input, contextMessageIds: new Map(kept), masks: new Map(kept.flatMap(([, id]) => (masks.data.has(id) ? [[id, masks.data.get(id)!] as const] : []))),
    photoOutcome, cut: fitted.cut });
}
