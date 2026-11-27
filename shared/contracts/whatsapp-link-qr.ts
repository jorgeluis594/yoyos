import { z } from "zod";

/**
 * The QR the phone shows to link WhatsApp, relayed to the seller's open web sessions so it can be scanned from a computer.
 * Nothing is stored: the phone sends every new QR and `null` once the QR is gone (linked, cancelled or expired).
 */
const linkQrSchema = z.strictObject({ value: z.string().min(1).max(1024), expiresAt: z.iso.datetime() });
export type LinkQr = z.infer<typeof linkQrSchema>;

/** `PUT /api/whatsapp-link/qr`: 204, 400. */
export const shareLinkQrRequestSchema = z.strictObject({ version: z.literal(1), qr: linkQrSchema.nullable() });
export type ShareLinkQrRequest = z.infer<typeof shareLinkQrRequestSchema>;

/** Messages of the `/api/whatsapp-link/qr/socket` WebSocket, server to browser. */
export const linkQrSocketMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("qr"), qr: linkQrSchema }),
  z.strictObject({ type: z.literal("cleared") }),
]);
export type LinkQrSocketMessage = z.infer<typeof linkQrSocketMessageSchema>;

export const linkQrSocketPath = "/api/whatsapp-link/qr/socket";
