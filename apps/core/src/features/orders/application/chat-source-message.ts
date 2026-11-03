import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ContactId, CompanyId, UserId } from "@core/src/features/orders/domain/order";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ImageId } from "@core/src/features/products/domain/product";

export type ChatSourceMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: ChatId;
  contactId: ContactId;
  direction: "incoming" | "outgoing";
  /** The seller of the orders this message creates. */
  uploadedByUserId: UserId;
  imageId: ImageId | null; // null for text messages
  text: string | null;
  caption: string | null;
  /** The times that anchor the context window and the trace's expiry. */
  sentAt: Date | null;
  receivedAt: Date;
}>;
