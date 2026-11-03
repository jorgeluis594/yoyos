import { z } from "zod";

export const linkActionSchema = z.enum(["copy", "share", "open"]);

/** `POST /api/orders/:orderId/link-actions`: 204, 400, 404, 503. `id` is the client's idempotency key. */
export const recordLinkActionRequestSchema = z.strictObject({ version: z.literal(1), id: z.uuid(), action: linkActionSchema });
export type RecordLinkActionRequest = z.infer<typeof recordLinkActionRequestSchema>;
