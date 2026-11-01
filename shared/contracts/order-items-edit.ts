import { z } from "zod";
import { orderAggregateSchema, orderStockDueSchema } from "@shared/contracts/orders";
import { orderRevisionSchema, orderRevisionsSchema } from "@shared/contracts/order-revisions";
import { maxOrderLineQuantity, maxOrderLines } from "@shared/orders-edit";

export { orderRevisionSchema, orderRevisionsSchema };

export const orderLineSchema = z.strictObject({ variantId: z.uuid(), quantity: z.number().int().min(1).max(maxOrderLineQuantity) });
/** The `lines` of an items edit: the web edit's items part and the mobile `PATCH` share it. */
export const orderLinesSchema = z.array(orderLineSchema).min(1).max(maxOrderLines);

/** `PATCH /api/orders/:orderId/items`: the mobile edit removes items and changes quantities through the existing `editOrder`. */
export const editOrderItemsRequestSchema = z.strictObject({ version: z.literal(1), base: orderRevisionSchema, lines: orderLinesSchema });
export type EditOrderItemsRequest = z.infer<typeof editOrderItemsRequestSchema>;

export const editOrderItemsResponseSchema = z.strictObject({
  order: orderAggregateSchema, revisions: orderRevisionsSchema, applied: z.array(z.literal("items")), stockDue: orderStockDueSchema.nullable(),
});
export type EditOrderItemsResponse = z.infer<typeof editOrderItemsResponseSchema>;

/** 409 for `ORDER_CHANGED`, `DELIVERY_LOCKED`, `ORDER_CANCELLED`; 422 for `VARIANT_NOT_FOUND`; 400 for `INVALID_INPUT`. */
export const editOrderItemsErrorSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.enum(["ORDER_CHANGED", "DELIVERY_LOCKED", "ORDER_CANCELLED", "INVALID_INPUT"]), error: z.string() }),
  z.strictObject({ code: z.literal("VARIANT_NOT_FOUND"), error: z.string(), variantId: z.uuid() }),
]);
export type EditOrderItemsError = z.infer<typeof editOrderItemsErrorSchema>;
