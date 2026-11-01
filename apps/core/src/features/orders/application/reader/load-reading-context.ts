import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { RecentChatMessage, RecentChatMessagesQuery } from "@core/src/features/chats/composition";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import type { StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import { pendingLife, type ChatPending, type ChatPendings, type LastIncomingPhoto, type PendingLife } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { capContextText, fitReadingInput, type BudgetCut, type ReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { ContextMessageRef, ItemRef, PendingRef, ReadingContextMessage, ReadingInput, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/reader/readings";

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

function pendingsOf(alive: readonly ChatPending[]): readonly ReadingPending[] {
  return alive.map((pending, index) => ({ ref: `Q${index + 1}` as PendingRef, pendingId: pending.id,
    productIds: pending.subject.kind === "variant" ? [pending.subject.productId] : pending.subject.candidates, known: pending.known, quantity: pending.quantity, doubtful: pending.doubt !== null }));
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
  const [masks, photo, openedSince] = await Promise.all([
    deps.findMaskedTexts(recent.map(({ id }) => id)),
    latestPhoto ? deps.findOutcome(latestPhoto.id) : Promise.resolve(ok<StoredChatMessageOutcome | null>(null)),
    openedSinceOf(deps, message.chatId, pendings),
  ]);
  if (!masks.success) return masks;
  if (!photo.success) return photo;
  if (!openedSince.success) return openedSince;
  const life = pendingLife(pendings, { target, openedSince: openedSince.data }, deps.clock(), deps.pendingTtlMs);
  const context = contextOf(recent, masks.data, budgets.contextMessageChars);
  const current = { messageId: message.id, kind: message.imageId ? "image" : "text", text: message.text ?? message.caption ?? "" };
  const fitted = fitReadingInput({ current, context, items: itemsOf(target, budgets.maxItems), pendings: pendingsOf(life.alive), photoMemory, photo: null }, budgets.stageInputMaxChars);
  const idOf = new Map(context.map(({ ref }, index) => [ref, recent[index]!.id] as const));
  const kept = fitted.input.context.map(({ ref }) => [ref, idOf.get(ref)!] as const);
  const photoOutcome = latestPhoto && photo.data ? { ref: context[recent.indexOf(latestPhoto)]!.ref, messageId: latestPhoto.id, outcome: photo.data } : null;
  return ok({ target, life, input: fitted.input, contextMessageIds: new Map(kept), masks: new Map(kept.flatMap(([, id]) => (masks.data.has(id) ? [[id, masks.data.get(id)!] as const] : []))),
    photoOutcome, cut: fitted.cut });
}
