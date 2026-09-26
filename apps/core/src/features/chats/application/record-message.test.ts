import { describe, expect, it, vi } from "vitest";
import { recordMessage, type RecordMessageDependencies } from "@core/src/features/chats/application/record-message";
import type { RecordMessageInput } from "@core/src/features/chats/domain/message";

const input: RecordMessageInput = { externalId: "wamid.123", contactPhone: "+14155552671", contactName: null, origin: { direction: "incoming", source: "contact" }, sentAt: new Date(1), receivedAt: new Date(2), content: { type: "text", text: " original text " } };
function dependencies(prior: string | null): RecordMessageDependencies {
  return {
    ensureContact: vi.fn(async () => ({ success: true as const, data: { id: "2e98e108-1821-4fd1-a507-21e3e00b76f1", phone: input.contactPhone, name: null, createdAt: new Date(0), updatedAt: new Date(0) } })),
    chats: {
      findMessageId: vi.fn(async () => ({ success: true as const, data: prior ? { id: prior } : null })),
      ensureChat: vi.fn(async () => ({ success: true as const, data: { id: "5b47b1ef-5d21-4c0b-9c53-3db6e5634b19", contactId: "2e98e108-1821-4fd1-a507-21e3e00b76f1", createdAt: new Date(0) } })),
      insertMessage: vi.fn(async ({ content }) => ({ success: true as const, data: { status: "stored" as const, messageId: content.type === "image" ? content.image.mediaId : "2e98e108-1821-4fd1-a507-21e3e00b76f1" } })),
    },
    transaction: (operation) => operation(),
  };
}

describe("recordMessage", () => {
  it("preserves message data and marks existing external IDs duplicate before effects", async () => {
    const fresh = dependencies(null);
    expect(await recordMessage(input, fresh)).toMatchObject({ success: true, data: { status: "stored" } });
    expect(fresh.chats.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ externalId: input.externalId, sentAt: input.sentAt, content: input.content }));
    const imageInput = { ...input, externalId: "wamid.image", content: { type: "image" as const, mediaId: "media-1", caption: " caption " } };
    const image = dependencies(null);
    await recordMessage(imageInput, image);
    expect(image.chats.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ content: { type: "image", caption: " caption ", image: { status: "pending", mediaId: "media-1", attempts: 0, nextAttemptAt: input.receivedAt } } }));
    const duplicate = dependencies("existing-id");
    expect(await recordMessage(input, duplicate)).toEqual({ success: true, data: { status: "duplicate", messageId: "existing-id" } });
    expect(duplicate.ensureContact).not.toHaveBeenCalled();
  });

  it("rejects invalid origins", async () => {
    const deps = dependencies(null);
    expect(await recordMessage({ ...input, origin: { direction: "incoming", source: "seller" } as never }, deps)).toMatchObject({ success: false, error: { code: "INVALID_MESSAGE" } });
  });
});
