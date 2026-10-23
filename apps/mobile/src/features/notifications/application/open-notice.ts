import type { Result } from "@shared/result";
import type { NoticeDestination, NoticeSession } from "../domain/notice-destination";

export type OpenNoticePorts = Readonly<{
  /** The chat of the phone's message that core knows by this id; `null` when the phone no longer has it. */
  findChatOfMessage: (messageId: string) => Promise<Result<string | null, { message: string }>>;
  /** Asks core (`GET /api/seller-notices/:messageId`) for the order of an order notice. */
  resolveOrder: (messageId: string) => Promise<Result<string, { message: string }>>;
  /** `true` when there is no unsaved sale or the seller agreed to discard it. */
  confirmDiscard: () => Promise<boolean>;
  go: Readonly<{
    chat: (chatId: string, noticeMessageId: string) => void;
    chatsList: (reason: "chat_missing") => void;
    order: (orderId: string) => void;
    home: () => void;
  }>;
}>;

export type OpenOutcome = "opened" | "chat_missing" | "cancelled" | "failed";

/**
 * Opens where a notice points. The destination is resolved before the discard confirmation, so a
 * seller never loses an unsaved sale for a notice that cannot be opened.
 */
export async function openNotice(destination: NoticeDestination, ports: OpenNoticePorts): Promise<OpenOutcome> {
  if (destination.target === "order") {
    const order = await ports.resolveOrder(destination.messageId);
    if (!order.success) return "failed";
    if (!(await ports.confirmDiscard())) return "cancelled";
    ports.go.order(order.data);
    return "opened";
  }
  const chat = await ports.findChatOfMessage(destination.messageId);
  if (!chat.success) return "failed";
  if (!(await ports.confirmDiscard())) return "cancelled";
  if (chat.data === null) {
    ports.go.chatsList("chat_missing");
    return "chat_missing";
  }
  ports.go.chat(chat.data, destination.messageId);
  return "opened";
}

export type PendingNotice = Readonly<{ kind: "open"; destination: NoticeDestination }> | Readonly<{ kind: "home" }>;

export type NoticeInbox = Readonly<{
  /** Keeps the destination in memory (the newest wins) until a session can open it. */
  hold: (destination: NoticeDestination) => void;
  /** With no session the destination stays held; with one it is consumed: opened for its own company, Home otherwise. */
  settle: (session: NoticeSession) => PendingNotice | null;
}>;

export function createNoticeInbox(): NoticeInbox {
  let held: NoticeDestination | null = null;
  return {
    hold: (destination) => { held = destination; },
    settle: (session) => {
      if (held === null || session === null) return null;
      const destination = held;
      held = null;
      return destination.companyId === session.companyId ? { kind: "open", destination } : { kind: "home" };
    },
  };
}
