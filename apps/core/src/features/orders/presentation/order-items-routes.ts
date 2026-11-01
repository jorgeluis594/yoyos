import express, { type Response } from "express";
import { z } from "zod";
import { editOrderItemsErrorSchema, editOrderItemsRequestSchema, editOrderItemsResponseSchema } from "@shared/contracts/order-items-edit";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders } from "@core/src/features/orders/composition";
import type { EditOrderInput } from "@core/src/features/orders/application/edit-order";
import { parseOrderLineQuantity, type OrderLineRequest } from "@core/src/features/orders/domain/order-edit";
import { parseOrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";

/** Authenticated: mounted after `requireApiCompany`, so every read and write runs in the session's company. */
export const orderItemsRoutes = express.Router();

const refusal = (response: Response, status: 400 | 409 | 422, error: z.input<typeof editOrderItemsErrorSchema>) =>
  response.status(status).json(editOrderItemsErrorSchema.parse(error));

/** The request's brands: the revision and the quantities. A malformed value is an invalid request. */
function itemsInputOf(orderId: OrderId, body: z.infer<typeof editOrderItemsRequestSchema>): EditOrderInput | null {
  const base = parseOrderRevision(body.base);
  const lines: OrderLineRequest[] = [];
  for (const line of body.lines) {
    const quantity = parseOrderLineQuantity(line.quantity);
    if (!quantity.success) return null;
    lines.push({ variantId: line.variantId as VariantId, quantity: quantity.data });
  }
  const [first, ...rest] = lines;
  return base.success && first ? { orderId, items: { base: base.data, lines: [first, ...rest] } } : null;
}

/** Mobile item editing: the final lines of the order, applied by the same `editOrder` the web edit uses, so revisions and locks are the web's. */
orderItemsRoutes.patch("/:orderId/items", async (request, response: Response<unknown, PrivateLocals>) => {
  const id = z.uuid().safeParse(request.params.orderId);
  const body = editOrderItemsRequestSchema.safeParse(request.body);
  if (!id.success || !body.success) return refusal(response, 400, { code: "INVALID_INPUT", error: "Invalid items edit" });
  const input = itemsInputOf(id.data as OrderId, body.data);
  if (!input) return refusal(response, 400, { code: "INVALID_INPUT", error: "Invalid items edit" });
  const { auth } = response.locals;
  try {
    const result = await orders.edit(input, { companyId: auth.company.id as CompanyId, userId: auth.user.id as UserId });
    if (!result.success) {
      const error = result.error;
      switch (error.code) {
        case "ORDER_CHANGED": return refusal(response, 409, { code: "ORDER_CHANGED", error: "The order changed since it was loaded" });
        case "DELIVERY_LOCKED": return refusal(response, 409, { code: "DELIVERY_LOCKED", error: "The order can no longer be edited" });
        case "ORDER_CANCELLED": return refusal(response, 409, { code: "ORDER_CANCELLED", error: "Order is cancelled" });
        case "VARIANT_NOT_FOUND": return refusal(response, 422, { code: "VARIANT_NOT_FOUND", error: "Variant not found", variantId: error.variantId });
        case "INVALID_ORDER":
        case "INVALID_INPUT": return refusal(response, 400, { code: "INVALID_INPUT", error: "Invalid items edit" });
        case "ORDER_NOT_FOUND": return apiError(response, 404, "ORDER_NOT_FOUND", "Order not found");
        case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
        default:
          log.error({ event: "order_items_edit_failed", operation: "edit_order_items", entryPoint: "mobile_api", orderId: id.data, userId: auth.user.id, errorCode: error.code }, "Unable to edit the order items");
          return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
      }
    }
    const { order, stockDue } = result.data;
    const json = toOrderAggregateJson(order, stockDue);
    return response.json(editOrderItemsResponseSchema.parse({ order: json, revisions: orders.revisions(order), applied: result.data.applied.filter((part) => part === "items"), stockDue: json.stockDue }));
  } catch (cause) {
    log.error({ event: "order_items_edit_failed", operation: "edit_order_items", entryPoint: "mobile_api", orderId: id.data, userId: auth.user.id, errorCode: "INTERNAL_ERROR", err: cause }, "Unable to edit the order items");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
