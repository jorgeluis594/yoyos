import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId, ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderId } from "@core/src/features/orders/domain/order";
import { namedOrderIds, openQuestionsOf, type OrderQuestionFacts } from "@core/src/features/orders/domain/open-questions";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

type Failure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type FindOpenQuestionsError = Failure | Readonly<{ code: "INVALID_INPUT"; message: string }>;

export type StoredOutcome = Readonly<{ messageId: ChatMessageId; outcomes: ChatMessageOutcomes; readAt: Date }>;
export type ChatQuestionState = Readonly<{ pendingIds: readonly ChatPendingId[]; lastRequestAt: Date | null }>;

export type FindOpenQuestionsDependencies = Readonly<{
  /** The outcomes of the company's messages among these ids; others are absent. */
  findOutcomes: (messageIds: readonly ChatMessageId[]) => Promise<Result<readonly StoredOutcome[], Failure>>;
  /** The chat of each message, by primary key. */
  findMessageChats: (messageIds: readonly ChatMessageId[]) => Promise<Result<ReadonlyMap<ChatMessageId, ChatId>, Failure>>;
  /** The pendings' ids and `lastRequestAt` of each chat that has a row. */
  findChatQuestionStates: (chatIds: readonly ChatId[]) => Promise<Result<ReadonlyMap<ChatId, ChatQuestionState>, Failure>>;
  findOrderQuestionFacts: (orderIds: readonly OrderId[]) => Promise<Result<ReadonlyMap<OrderId, OrderQuestionFacts>, Failure>>;
}>;

export type MessageQuestions = Readonly<{ messageId: ChatMessageId; questions: readonly SuggestedQuestion[] }>;

const maxMessages = 100;

/** The open suggested questions of the messages a chat view shows: four batched primary-key reads, and only messages that have some are returned. */
export async function findOpenQuestions(messageIds: readonly ChatMessageId[], deps: FindOpenQuestionsDependencies): Promise<Result<readonly MessageQuestions[], FindOpenQuestionsError>> {
  if (messageIds.length < 1 || messageIds.length > maxMessages) return err({ code: "INVALID_INPUT", message: "Between 1 and 100 message ids are required" });
  const outcomes = await deps.findOutcomes(messageIds);
  if (!outcomes.success) return outcomes;
  const withQuestions = outcomes.data.filter((stored) => stored.outcomes.some((outcome) => outcome.kind === "questions"));
  if (withQuestions.length === 0) return ok([]);
  const ids = withQuestions.map((stored) => stored.messageId);
  const chats = await deps.findMessageChats(ids);
  if (!chats.success) return chats;
  const states = await deps.findChatQuestionStates([...new Set(chats.data.values())]);
  if (!states.success) return states;
  const orderIds = [...new Set(withQuestions.flatMap((stored) => namedOrderIds(stored.outcomes)))];
  const orders = orderIds.length > 0 ? await deps.findOrderQuestionFacts(orderIds) : ok(new Map<OrderId, OrderQuestionFacts>());
  if (!orders.success) return orders;

  const result: MessageQuestions[] = [];
  for (const stored of withQuestions) {
    const chatId = chats.data.get(stored.messageId);
    if (!chatId) continue;
    const state = states.data.get(chatId);
    const questions = openQuestionsOf(stored.outcomes, {
      readAt: stored.readAt,
      alivePendingIds: new Set(state?.pendingIds ?? []),
      lastRequestAt: state?.lastRequestAt ?? null,
      orders: orders.data,
    });
    if (questions.length > 0) result.push({ messageId: stored.messageId, questions });
  }
  return ok(result);
}
