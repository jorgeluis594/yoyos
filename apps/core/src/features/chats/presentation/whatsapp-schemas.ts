import { z } from "zod";
import { normalizePhone } from "@core/src/features/contacts/domain/contact";
import type { MessageOrigin, ReceivedContent, RecordMessageInput } from "@core/src/features/chats/domain/message";

const textSchema = z.object({ body: z.string() }).passthrough();
const imageSchema = z.object({ id: z.string().min(1), caption: z.string().nullable().optional() }).passthrough();
const messageSchema = z.object({ id: z.string().min(1), from: z.string().min(1).optional(), to: z.string().min(1).optional(), timestamp: z.union([z.string(), z.number()]), type: z.string(), text: textSchema.optional(), image: imageSchema.optional() }).passthrough();
const contactSchema = z.object({ wa_id: z.string().min(1), profile: z.object({ name: z.string().nullable().optional() }).passthrough().optional() }).passthrough();
const valueSchema = z.object({ metadata: z.object({ phone_number_id: z.string().min(1), display_phone_number: z.string().optional() }).passthrough(), contacts: z.array(contactSchema).optional(), messages: z.array(z.unknown()).optional(), message_echoes: z.array(z.unknown()).optional(), statuses: z.array(z.unknown()).optional() }).passthrough();
const changeSchema = z.object({ field: z.string(), value: valueSchema }).passthrough();
const entrySchema = z.object({ id: z.string().optional(), changes: z.array(changeSchema) }).passthrough();
export const whatsappEnvelopeSchema = z.object({ object: z.string(), entry: z.array(entrySchema) }).passthrough();

export type IgnoredEventReason = "unsupported_type" | "delivery_status" | "group" | "history" | "before_connection" | "edit_or_delete";
export type NormalizedEvent = Readonly<{ status: "message"; phoneNumberId: string; businessAccountId: string; message: Omit<RecordMessageInput, "receivedAt"> }> | Readonly<{ status: "ignored"; reason: IgnoredEventReason }>;
export type ParsedWebhook = Readonly<{ events: readonly NormalizedEvent[]; malformed: number }>;

function messageContent(message: z.infer<typeof messageSchema>): ReceivedContent | null {
  if (message.type === "text" && message.text) return { type: "text", text: message.text.body };
  if (message.type === "image" && message.image) return { type: "image", mediaId: message.image.id, caption: message.image.caption ?? null };
  return null;
}

export function parseWhatsAppWebhook(input: unknown): ParsedWebhook | null {
  const parsed = whatsappEnvelopeSchema.safeParse(input);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return null;
  const events: NormalizedEvent[] = [];
  let malformed = 0;
  for (const entry of parsed.data.entry) for (const change of entry.changes) {
    if (change.field !== "messages" && change.field !== "smb_message_echoes") { events.push({ status: "ignored", reason: change.field === "history" ? "history" : "unsupported_type" }); continue; }
    const value = change.value;
    const map = (inputMessage: unknown, outgoing: boolean) => {
      const parsedMessage = messageSchema.safeParse(inputMessage);
      if (!parsedMessage.success) {
        if (typeof inputMessage === "object" && inputMessage !== null && "type" in inputMessage && ["text", "image"].includes(String(inputMessage.type))) malformed++;
        else events.push({ status: "ignored", reason: "unsupported_type" });
        return;
      }
      const message = parsedMessage.data;
      if (["edited", "deleted", "revoked"].includes(message.type) || "edited_message" in message || "deleted_message" in message || message.is_edited === true || message.is_deleted === true) {
        events.push({ status: "ignored", reason: "edit_or_delete" });
        return;
      }
      const content = messageContent(message);
      const phone = outgoing ? message.to : message.from;
      const timestamp = typeof message.timestamp === "number" ? message.timestamp * 1000 : Number(message.timestamp) * 1000;
      const sentAt = new Date(timestamp);
      if (!content) {
        if (message.type === "text" || message.type === "image") malformed++;
        else events.push({ status: "ignored", reason: "unsupported_type" });
        return;
      }
      if (!phone || phone.includes("@g.us")) { events.push({ status: "ignored", reason: "group" }); return; }
      const contactPhone = normalizePhone(phone.startsWith("+") ? phone : `+${phone}`);
      if (!contactPhone) { malformed++; return; }
      if (!Number.isFinite(sentAt.getTime())) { malformed++; return; }
      const contact = !outgoing ? value.contacts?.find((candidate) => candidate.wa_id === phone) : undefined;
      const origin: MessageOrigin = outgoing ? { direction: "outgoing", source: "seller", userId: null } : { direction: "incoming", source: "contact" };
      events.push({ status: "message", phoneNumberId: value.metadata.phone_number_id, businessAccountId: entry.id ?? "", message: {
        externalId: message.id, contactPhone, contactName: contact?.profile?.name ?? null,
        origin, sentAt, content,
      } });
    };
    if (change.field === "messages") {
      for (const message of value.messages ?? []) map(message, false);
      if ((value.statuses?.length ?? 0) > 0 && !(value.messages?.length)) events.push({ status: "ignored", reason: "delivery_status" });
    } else {
      for (const message of value.message_echoes ?? []) map(message, true);
    }
  }
  return { events, malformed };
}
