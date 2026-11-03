import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { chatMessageOutcomesSchema } from "@core/src/features/orders/domain/chat-message-outcome";
import { chatPendingsSchema } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderQuestionFacts } from "@core/src/features/orders/domain/open-questions";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ChatQuestionState, StoredOutcome } from "@core/src/features/orders/application/find-open-questions";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type Failure = PersistenceError | InvalidStoredData;

/** Runs one read; a persistence failure is logged and answered, anything else is a bug and propagates. */
async function read<T>(event: string, work: () => Promise<Result<T, Failure>>): Promise<Result<T, Failure>> {
  try {
    return await work();
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event, companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, event);
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read open questions" });
  }
}

const invalid = (event: string) => {
  log.error({ event, companyId: getCompanyId(), errorCode: "INVALID_STORED_DATA" }, event);
  return err({ code: "INVALID_STORED_DATA" as const, message: "Invalid stored data" });
};

/** Outcomes of the company's messages by primary key; the row's creation time is the message's read time. */
export function findOutcomes(messageIds: readonly ChatMessageId[]): Promise<Result<readonly StoredOutcome[], Failure>> {
  return read("unable_to_find_outcomes_for_questions", async () => {
    const rows = await prisma.chatMessageOutcome.findMany({ where: { companyId: getCompanyId(), messageId: { in: [...messageIds] } }, select: { messageId: true, outcomes: true, createdAt: true } });
    const found: StoredOutcome[] = [];
    for (const row of rows) {
      const parsed = chatMessageOutcomesSchema.safeParse(row.outcomes);
      if (!parsed.success) return invalid("invalid_stored_chat_message_outcome");
      found.push({ messageId: row.messageId as ChatMessageId, outcomes: parsed.data, readAt: row.createdAt });
    }
    return ok(found);
  });
}

export function findMessageChats(messageIds: readonly ChatMessageId[]): Promise<Result<ReadonlyMap<ChatMessageId, ChatId>, Failure>> {
  return read("unable_to_find_message_chats", async () => {
    const rows = await prisma.chatMessage.findMany({ where: { companyId: getCompanyId(), id: { in: [...messageIds] } }, select: { id: true, chatId: true } });
    return ok(new Map(rows.map((row) => [row.id as ChatMessageId, row.chatId as ChatId])));
  });
}

export function findChatQuestionStates(chatIds: readonly ChatId[]): Promise<Result<ReadonlyMap<ChatId, ChatQuestionState>, Failure>> {
  return read("unable_to_find_chat_question_states", async () => {
    const rows = await prisma.chatPendings.findMany({ where: { companyId: getCompanyId(), chatId: { in: [...chatIds] } }, select: { chatId: true, pendings: true, readyRemembered: true, lastRequestAt: true } });
    const states = new Map<ChatId, ChatQuestionState>();
    for (const row of rows) {
      const parsed = chatPendingsSchema.safeParse({ pendings: row.pendings, readyRemembered: row.readyRemembered });
      if (!parsed.success) return invalid("invalid_stored_chat_pendings");
      states.set(row.chatId as ChatId, { pendingIds: parsed.data.pendings.map((pending) => pending.id), lastRequestAt: row.lastRequestAt });
    }
    return ok(states);
  });
}

type OrderRow = Readonly<{ id: string; sellerActedAt: Date | null; open: boolean }>;

/** `open` mirrors `isOpenForMessageItems` (without the chat, which the outcome already names). */
export function findOrderQuestionFacts(orderIds: readonly OrderId[]): Promise<Result<ReadonlyMap<OrderId, OrderQuestionFacts>, Failure>> {
  return read("unable_to_find_order_question_facts", async () => {
    const rows = await prisma.$queryRaw<OrderRow[]>`SELECT o.id, o."sellerActedAt",
        (o.cancelled = false AND o."completedAt" IS NULL AND o."checkoutConfirmedAt" IS NULL AND o."deliveryStatus" = 'pending' AND o."stockDeducted" = false
          AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p."companyId" = o."companyId" AND p.status <> 'voided')) AS open
      FROM "Order" o WHERE o."companyId" = ${getCompanyId()}::uuid AND o.id = ANY(${[...orderIds]}::uuid[])`;
    return ok(new Map(rows.map((row) => [row.id as OrderId, { open: row.open, sellerActedAt: row.sellerActedAt }])));
  });
}
