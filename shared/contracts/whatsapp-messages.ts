import { z } from "zod";

const byteLength = (value: string) => new TextEncoder().encode(value).length;
const validUnicode = (value: string) => !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const limitedText = (maximum: number) => z.string().refine((value) => validUnicode(value) && byteLength(value) >= 1 && byteLength(value) <= maximum);
const lidSchema = z.string().regex(/^[0-9]+@lid$/).refine((value) => byteLength(value) <= 128);
const protocolMessageIdSchema = limitedText(512);
const messageTextSchema = limitedText(65536);
const nativeMessageIdSchema = z.string().startsWith("wa-message:v1:").refine((value) => byteLength(value) <= 4096);
const unixMillisecondsSchema = z.number().int().min(0).max(253402300799999);

function decodedIdentity(id: string): unknown {
  const encoded = id.slice("wa-message:v1:".length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return null;
  try {
    const raw = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Re-encoding rejects noncanonical Base64url spellings with unused trailing bits.
    const canonical = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return canonical === encoded ? JSON.parse(decoded) : null;
  } catch { return null; }
}

const messageEnvelope = z.strictObject({
  id: nativeMessageIdSchema,
  accountId: lidSchema,
  chatId: lidSchema,
  whatsappMessageId: protocolMessageIdSchema,
  direction: z.enum(["incoming", "outgoing"]),
  // Absent when WhatsApp's own time was missing; the date is unknown and is never replaced by the reception time.
  timestamp: unixMillisecondsSchema.optional(),
});

function checkIdentity(message: Readonly<{ id: string; accountId: string; chatId: string; whatsappMessageId: string }>, context: z.RefinementCtx) {
  const identity = decodedIdentity(message.id);
  if (!Array.isArray(identity) || identity.length !== 3 || identity[0] !== message.accountId || identity[1] !== message.chatId || identity[2] !== message.whatsappMessageId)
    context.addIssue({ code: "custom", path: ["id"], message: "IDENTITY_MISMATCH" });
}

/** The message envelope without its content, with the identity consistency check. */
export const whatsAppMessageIdentitySchema = messageEnvelope.superRefine(checkIdentity);

export const registerWhatsAppMessageRequestSchema = z.strictObject({
  version: z.literal(1),
  message: messageEnvelope.extend({
    content: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("text"), text: messageTextSchema }),
      z.strictObject({ type: z.literal("image"), imageId: z.uuid(), caption: messageTextSchema.optional() }),
    ]),
  }).superRefine(checkIdentity),
});

export const registerWhatsAppMessageResponseSchema = z.strictObject({
  status: z.enum(["stored", "duplicate"]),
  messageId: z.uuid(),
  eventId: z.uuid(),
  receivedAt: z.iso.datetime({ offset: false }),
});

export type RegisterWhatsAppMessageRequest = z.infer<typeof registerWhatsAppMessageRequestSchema>;
export type RegisterWhatsAppMessageResponse = z.infer<typeof registerWhatsAppMessageResponseSchema>;
export type WhatsAppMessageIdentity = z.infer<typeof whatsAppMessageIdentitySchema>;
