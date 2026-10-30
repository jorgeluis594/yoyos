import { z } from "zod";
import { moneySchema } from "@shared/contracts/money";
import { agencyRecipientSchema, newOrderCustomerSchema, orderAggregateSchema, ratedDeliverySelectionSchema, recipientSchema } from "@shared/contracts/orders";
import { maxOrderLineQuantity, maxOrderLines } from "@shared/orders-edit";

export const orderRevisionSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const orderRevisionsSchema = z.strictObject({ items: orderRevisionSchema, customer: orderRevisionSchema, delivery: orderRevisionSchema });

const lineSchema = z.strictObject({ variantId: z.uuid(), quantity: z.number().int().min(1).max(maxOrderLineQuantity) });
const reference = z.string().trim().max(1000).nullable().transform((value) => value || null);
const amendmentSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, address: z.string().trim().min(1).max(500), instructions: reference }),
  z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema }),
]);

export const editOrderRequestSchema = z.strictObject({
  operation: z.literal("save_changes"),
  items: z.strictObject({ base: orderRevisionSchema, lines: z.array(lineSchema).min(1).max(maxOrderLines) }).optional(),
  customer: z.strictObject({ base: orderRevisionSchema, value: newOrderCustomerSchema.nullable() }).optional(),
  delivery: z.strictObject({ base: orderRevisionSchema, change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("replace"), selection: ratedDeliverySelectionSchema, expectedPrice: moneySchema }),
    z.strictObject({ kind: z.literal("amend"), amendment: amendmentSchema }),
  ]) }).optional(),
}).refine((body) => body.items || body.customer || body.delivery);
export type EditOrderRequest = z.infer<typeof editOrderRequestSchema>;

/** Absent variant = not sellable; `null` = stock unknown. */
export const orderLineCatalogSchema = z.record(z.uuid(), z.strictObject({ stock: z.number().int().nonnegative().safe() })).nullable();
export const editOrderResultSchema = z.strictObject({ order: orderAggregateSchema, revisions: orderRevisionsSchema, lineCatalog: orderLineCatalogSchema,
  applied: z.array(z.enum(["items", "customer", "delivery"])) });
export type EditOrderResult = z.infer<typeof editOrderResultSchema>;
