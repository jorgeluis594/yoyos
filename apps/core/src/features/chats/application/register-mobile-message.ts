import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { MessageCreated } from "@core/src/features/chats/application/events";
import type { EventMetadata } from "@core/src/shared/events/application/contracts";
import type { ChatMessageId, ImageId, MobileMessageInput, NewMobileMessage, RegisterMobileMessageError, RegisterOutcome, RegistrationContext, StoreOutcome } from "@core/src/features/chats/domain/mobile-message";

type Failure = RegisterMobileMessageError;
export type RegisterMobileMessageDependencies = Readonly<{
  findImage: (imageId: ImageId) => Promise<Result<boolean, Failure>>;
  storeOnce: (input: NewMobileMessage) => Promise<Result<StoreOutcome, Failure>>;
  markEventDispatched: (companyId: RegistrationContext["companyId"], messageId: ChatMessageId, at: Date) => Promise<Result<void, Failure>>;
  dispatchMessageRecorded: (payload: MessageCreated, metadata: EventMetadata) => Promise<Result<void, Failure>>;
  newMessageId: () => ChatMessageId;
  now: () => Date;
}>;

export async function registerMobileMessage(input: MobileMessageInput, context: RegistrationContext, dependencies: RegisterMobileMessageDependencies): Promise<Result<RegisterOutcome, Failure>> {
  if (input.content.type === "image") {
    const image = await dependencies.findImage(input.content.imageId);
    if (!image.success) return image;
    if (!image.data) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  }
  const stored = await dependencies.storeOnce({ ...input, ...context, id: dependencies.newMessageId(), receivedAt: dependencies.now() });
  if (!stored.success) return stored;
  const { created, message } = stored.data;
  if (message.companyId !== context.companyId) return err({ code: "INVALID_STORED_DATA", message: "Invalid stored message" });
  if (!message.eventDispatchedAt) {
    // ponytail: Without another POST a pending event cannot recover; autonomous recovery needs a durable relay.
    const dispatched = await dependencies.dispatchMessageRecorded(
      { companyId: message.companyId, chatId: message.chatId, messageId: message.id },
      { eventId: message.id, occurredAt: message.receivedAt.toISOString() },
    );
    if (!dispatched.success) return dispatched;
    const marked = await dependencies.markEventDispatched(message.companyId, message.id, dependencies.now());
    if (!marked.success) return marked;
  }
  return ok({ status: created ? "stored" : "duplicate", messageId: message.id, eventId: message.id, receivedAt: message.receivedAt });
}
