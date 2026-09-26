import { describe, expect, it } from "vitest";
import { parseWhatsAppWebhook } from "@core/src/features/chats/presentation/whatsapp-schemas";

describe("parseWhatsAppWebhook", () => {
  it("walks all entries and normalizes incoming and seller echo messages without trimming text", () => {
    const result = parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [
      { id: "waba-1", changes: [
        { field: "messages", value: { metadata: { phone_number_id: "phone-1" }, contacts: [{ wa_id: "14155552671", profile: { name: "Sam" } }], messages: [{ id: "m1", from: "14155552671", timestamp: "10", type: "text", text: { body: " hi " } }] } },
        { field: "smb_message_echoes", value: { metadata: { phone_number_id: "phone-1" }, message_echoes: [{ id: "m2", to: "14155552671", timestamp: "11", type: "image", image: { id: "media-1", caption: " caption " } }] } },
      ] },
      { id: "waba-1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: "status", from: "1", timestamp: "12", type: "audio" }] } }] },
    ] });
    expect(result?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "message", message: expect.objectContaining({ contactPhone: "+14155552671", contactName: "Sam", content: { type: "text", text: " hi " }, origin: { direction: "incoming", source: "contact" } }) }),
      expect.objectContaining({ status: "message", message: expect.objectContaining({ contactPhone: "+14155552671", content: { type: "image", mediaId: "media-1", caption: " caption " }, origin: { direction: "outgoing", source: "seller", userId: null } }) }),
      { status: "ignored", reason: "unsupported_type" },
    ]));
  });

  it("marks malformed supported messages without discarding valid siblings", () => {
    const result = parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ id: "waba-1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-1" }, messages: [
      { id: "bad", from: "14155552671", timestamp: "bad", type: "text", text: { body: "x" } },
      { id: "ok", from: "14155552671", timestamp: "10", type: "text", text: { body: "x" } },
    ] } }] }] });
    expect(result?.malformed).toBe(1);
    expect(result?.events.filter(({ status }) => status === "message")).toHaveLength(1);
  });

  it("does not accept echoes embedded in messages or under the wrong value key", () => {
    const result = parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ id: "waba-1", changes: [
      { field: "messages", value: { metadata: { phone_number_id: "phone-1" }, smb_message_echoes: [{ id: "wrong-field", to: "14155552671", timestamp: "10", type: "text", text: { body: "x" } }] } },
      { field: "smb_message_echoes", value: { metadata: { phone_number_id: "phone-1" }, smb_message_echoes: [{ id: "wrong-key", to: "14155552671", timestamp: "10", type: "text", text: { body: "x" } }] } },
    ] }] });
    expect(result?.events).toEqual([]);
  });

  it("ignores groups, history and delivery statuses while flagging broken supported data", () => {
    const result = parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ id: "waba-1", changes: [
      { field: "messages", value: { metadata: { phone_number_id: "phone-1" }, messages: [
        { id: "group", from: "123@g.us", timestamp: "10", type: "text", text: { body: "group" } },
        { id: "broken", from: "14155552671", timestamp: "10", type: "image" },
        { id: "audio", from: "14155552671", timestamp: "10", type: "audio" },
        { id: "edit", from: "14155552671", timestamp: "10", type: "deleted" },
      ] } },
      { field: "history", value: { metadata: { phone_number_id: "phone-1" } } },
      { field: "messages", value: { metadata: { phone_number_id: "phone-1" }, statuses: [{ id: "status" }] } },
    ] }] });
    expect(result?.malformed).toBe(1);
    expect(result?.events).toEqual(expect.arrayContaining([
      { status: "ignored", reason: "group" },
      { status: "ignored", reason: "unsupported_type" },
      { status: "ignored", reason: "history" },
      { status: "ignored", reason: "delivery_status" },
      { status: "ignored", reason: "edit_or_delete" },
    ]));
  });
});
