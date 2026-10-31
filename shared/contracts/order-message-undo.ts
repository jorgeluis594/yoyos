import { z } from "zod";
import { orderAggregateSchema } from "@shared/contracts/orders";
import { orderReviewResponseSchema, undoRefusalSchema } from "@shared/contracts/order-review";

/** `POST /api/orders/:orderId/messages/:messageId/undo`: 200, 409 refused, 404, 503. A repeat of an undone message answers 200. */
export const undoMessageResponseSchema = z.strictObject({ order: orderAggregateSchema, review: orderReviewResponseSchema });
export type UndoMessageResponse = z.infer<typeof undoMessageResponseSchema>;

/** `variantId` is present when the variant is no longer sold (`not_sold`). */
export const undoMessageErrorSchema = z.strictObject({ code: z.literal("UNDO_REFUSED"), error: z.string(), reason: undoRefusalSchema, variantId: z.uuid().optional() });
export type UndoMessageError = z.infer<typeof undoMessageErrorSchema>;
