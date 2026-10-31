import { z } from "zod";
import { mentionedPriceSchema, moneySchema, orderAggregateSchema, orderStockDueSchema } from "@shared/contracts/orders";
import { orderRevisionSchema } from "@shared/contracts/order-revisions";
import { maxOrderLineQuantity } from "@shared/orders-edit";

const date = z.iso.datetime();
const count = z.number().int().nonnegative().safe();

type DoubtReason =
  | { kind: "variant_changed"; attribute: string; from: string; to: string }
  | { kind: "quantity_set"; quantity: number }
  | { kind: "added_by_reference"; quantity: number; quote: number | null }
  | { kind: "removed"; product: string }
  | { kind: "caption_unread" }
  | { kind: "inherited"; from: DoubtReason };
/** Reasons travel as structured kinds; clients render them. */
export const doubtReasonSchema: z.ZodType<DoubtReason> = z.lazy(() => z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("variant_changed"), attribute: z.string(), from: z.string(), to: z.string() }),
  z.strictObject({ kind: z.literal("quantity_set"), quantity: z.number().int().positive().safe() }),
  z.strictObject({ kind: z.literal("added_by_reference"), quantity: z.number().int().positive().safe(), quote: count.nullable() }),
  z.strictObject({ kind: z.literal("removed"), product: z.string() }),
  z.strictObject({ kind: z.literal("caption_unread") }),
  z.strictObject({ kind: z.literal("inherited"), from: doubtReasonSchema }),
]));

/** A line of the order as a change saw it: the copied name and attributes are its label. */
export const reviewLineSchema = z.strictObject({
  itemId: z.uuid(), variantId: z.uuid(), productName: z.string(), variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(),
  quantity: z.number().int().positive().safe(), unitPrice: moneySchema, mentionedPrice: mentionedPriceSchema.nullable(), position: count,
});
export const reviewChangeSchema = z.strictObject({
  id: z.uuid(), messageId: z.uuid(), position: count, seq: count, kind: z.enum(["added", "removed", "quantity_changed", "variant_changed", "mentioned_price_set"]),
  before: reviewLineSchema.nullable(), after: reviewLineSchema.nullable(),
  decision: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("applied") }), z.strictObject({ kind: z.literal("doubtful"), reason: doubtReasonSchema })]),
  verdict: z.strictObject({ kind: z.enum(["kept", "quantity_changed", "removed", "undone", "not_reviewed"]), at: date }).nullable(),
  createdAt: date,
});
export const undoRefusalSchema = z.enum(["order_moved_on", "later_change", "would_empty", "not_sold"]);
export const reviewPointKeySchema = z.strictObject({ pendingId: z.uuid(), since: date });
export const reviewPointSchema = z.strictObject({
  pendingId: z.uuid(), since: date, kind: z.enum(["variant_missing", "not_clear", "variant_not_available"]), product: z.string().nullable(),
  quantity: z.number().int().positive().safe(), missing: z.array(z.string()), doubt: doubtReasonSchema.nullable(), acknowledged: z.boolean(),
  /** The suggested question for the buyer, already rendered in the buyer's language. */
  question: z.string().min(1),
});
/** What the client sends back unchanged: the snapshot the review was shown against. */
export const reviewLoadedSchema = z.strictObject({
  changesThrough: count, changeIds: z.array(z.uuid()), points: z.array(reviewPointKeySchema), itemsRevision: orderRevisionSchema,
});

/** `GET /api/orders/:orderId/review[?rows=all]`: 200, 404, 503. */
export const orderReviewResponseSchema = z.strictObject({
  version: z.literal(1),
  status: z.strictObject({ openForMessages: z.boolean(), toReview: z.boolean(), doubtfulCount: count, pointCount: count,
    entry: z.enum(["link", "detail", "none"]), hasPreviousReview: z.boolean() }),
  doubtful: z.array(z.strictObject({ change: reviewChangeSchema, quote: z.string().nullable() })),
  points: z.array(reviewPointSchema),
  products: z.array(z.strictObject({ itemId: z.uuid(), changedSinceLastReview: z.boolean() })),
  removedSinceLastReview: z.array(reviewLineSchema),
  messageRows: z.array(z.strictObject({ messageId: z.uuid(), at: date, changes: z.array(reviewChangeSchema),
    undo: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("available") }),
      z.strictObject({ kind: z.literal("refused"), reason: undoRefusalSchema }),
      z.strictObject({ kind: z.literal("undone") }),
    ]) })),
  moreRows: count,
  loaded: reviewLoadedSchema,
});
export type OrderReviewResponse = z.infer<typeof orderReviewResponseSchema>;

/** `POST /api/orders/:orderId/reviews`. `id` is the client's idempotency key; a quantity of 0 removes the item. */
export const confirmOrderReviewRequestSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  origin: z.enum(["link", "detail"]),
  linkAction: z.strictObject({ id: z.uuid(), action: z.enum(["copy", "share", "open"]) }).nullable(),
  loaded: reviewLoadedSchema,
  corrections: z.array(z.strictObject({ itemId: z.uuid(), quantity: z.number().int().min(0).max(maxOrderLineQuantity) })),
});
export type ConfirmOrderReviewRequest = z.infer<typeof confirmOrderReviewRequestSchema>;

export const confirmOrderReviewResponseSchema = z.strictObject({
  version: z.literal(1),
  review: z.strictObject({ id: z.uuid(), origin: z.enum(["link", "detail"]), correctedItems: count, confirmedAt: date }),
  order: orderAggregateSchema,
  /** The sure changes that arrived while the seller reviewed. */
  changedMeanwhile: z.array(reviewChangeSchema),
  total: moneySchema,
  stockDue: orderStockDueSchema.nullable(),
});
export type ConfirmOrderReviewResponse = z.infer<typeof confirmOrderReviewResponseSchema>;

/** 409 for `REVIEW_OUTDATED`, `ORDER_CHANGED`, `DELIVERY_LOCKED`, `ORDER_CANCELLED`; 422 for `LAST_ITEM`, `VARIANT_NOT_FOUND`; 400 for `INVALID_INPUT`. */
export const orderReviewErrorSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("REVIEW_OUTDATED"), error: z.string(), affectedItemIds: z.array(z.uuid()), newPoints: count }),
  z.strictObject({ code: z.enum(["ORDER_CHANGED", "DELIVERY_LOCKED", "ORDER_CANCELLED", "LAST_ITEM", "INVALID_INPUT"]), error: z.string() }),
  z.strictObject({ code: z.literal("VARIANT_NOT_FOUND"), error: z.string(), variantId: z.uuid() }),
]);
export type OrderReviewError = z.infer<typeof orderReviewErrorSchema>;
