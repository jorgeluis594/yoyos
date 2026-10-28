import { z } from "zod";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

export type ProductIdentification = Readonly<{ method: "qr" | "visual" | "text"; productId: ProductId; confidence: number | null }>;

export type ChatMessageFailureCode =
  | "MESSAGE_NOT_FOUND" | "CONTACT_NOT_FOUND" | "SELLER_UNAVAILABLE" | "CURRENCY_MISMATCH" | "INVALID_ORDER" | "INVALID_STORED_DATA"
  | "INVALID_MATCHER_RESPONSE" | "INVALID_EMBEDDING" | "INVALID_AI_RESPONSE" | "RETRIES_EXHAUSTED";

export type ChatMessageOutcome =
  | Readonly<{ kind: "added"; variantId: VariantId; quantity: PositiveInteger; identification: ProductIdentification }>
  | Readonly<{ kind: "removed" | "quantity_lowered"; variantId: VariantId; namedItem: boolean }>
  | Readonly<{ kind: "quantity_changed"; variantId: VariantId; quantity: PositiveInteger; namedItem: boolean }>
  | Readonly<{ kind: "variant_changed"; fromVariantId: VariantId; toVariantId: VariantId; namedItem: boolean }>
  | Readonly<{ kind: "mentioned_price_set"; variantId: VariantId }>
  | Readonly<{ kind: "ready" | "only_item_kept" | "order_closed"; orderId: OrderId }>
  | Readonly<{ kind: "no_intent" | "ambiguous_intent" | "variant_only" | "unnamed_add" | "image_with_request" | "no_open_order" }>
  | Readonly<{ kind: "not_identified"; source: "photo" | "text"; identification: ProductIdentification | null; silent: boolean }>
  | Readonly<{ kind: "not_clear"; productIds: readonly ProductId[]; silent: boolean }>
  | Readonly<{ kind: "variant_missing" | "variant_not_available" | "quantity_above_limit"; productId: ProductId; identification: ProductIdentification | null }>
  | Readonly<{ kind: "unclear_item"; orderId: OrderId | null; namedItem: boolean; namedProductId: ProductId | null }>
  | Readonly<{ kind: "new_order_after_closed"; orderId: OrderId; previousOrderId: OrderId }>
  | Readonly<{ kind: "failed"; errorCode: ChatMessageFailureCode }>;

export type ChatMessageOutcomes = readonly [ChatMessageOutcome, ...ChatMessageOutcome[]];

/** What is stored for a read message: its outcomes and whether its notice was already claimed. */
export type StoredChatMessageOutcome = Readonly<{ outcomes: ChatMessageOutcomes; noticeSentAt: Date | null }>;

const uuid = z.uuid();
const orderId = uuid.transform((value) => value as OrderId);
const productId = uuid.transform((value) => value as ProductId);
const variantId = uuid.transform((value) => value as VariantId);
const quantity = z.number().int().min(1).transform((value) => value as PositiveInteger);
const identification = z.strictObject({ method: z.enum(["qr", "visual", "text"]), productId, confidence: z.number().min(0).max(1).nullable() });
const failureCode = z.enum(["MESSAGE_NOT_FOUND", "CONTACT_NOT_FOUND", "SELLER_UNAVAILABLE", "CURRENCY_MISMATCH", "INVALID_ORDER", "INVALID_STORED_DATA",
  "INVALID_MATCHER_RESPONSE", "INVALID_EMBEDDING", "INVALID_AI_RESPONSE", "RETRIES_EXHAUSTED"]);

const outcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("added"), variantId, quantity, identification }),
  z.strictObject({ kind: z.enum(["removed", "quantity_lowered"]), variantId, namedItem: z.boolean() }),
  z.strictObject({ kind: z.literal("quantity_changed"), variantId, quantity, namedItem: z.boolean() }),
  z.strictObject({ kind: z.literal("variant_changed"), fromVariantId: variantId, toVariantId: variantId, namedItem: z.boolean() }),
  z.strictObject({ kind: z.literal("mentioned_price_set"), variantId }),
  z.strictObject({ kind: z.enum(["ready", "only_item_kept", "order_closed"]), orderId }),
  z.strictObject({ kind: z.enum(["no_intent", "ambiguous_intent", "variant_only", "unnamed_add", "image_with_request", "no_open_order"]) }),
  z.strictObject({ kind: z.literal("not_identified"), source: z.enum(["photo", "text"]), identification: identification.nullable(), silent: z.boolean() }),
  z.strictObject({ kind: z.literal("not_clear"), productIds: z.array(productId), silent: z.boolean() }),
  z.strictObject({ kind: z.enum(["variant_missing", "variant_not_available", "quantity_above_limit"]), productId, identification: identification.nullable() }),
  z.strictObject({ kind: z.literal("unclear_item"), orderId: orderId.nullable(), namedItem: z.boolean(), namedProductId: productId.nullable() }),
  z.strictObject({ kind: z.literal("new_order_after_closed"), orderId, previousOrderId: orderId }),
  z.strictObject({ kind: z.literal("failed"), errorCode: failureCode }),
]);

/** Validates the outcomes JSON on write and on read; a stored mismatch is `INVALID_STORED_DATA`. */
export const chatMessageOutcomesSchema: z.ZodType<ChatMessageOutcomes> = z.tuple([outcomeSchema], outcomeSchema);
