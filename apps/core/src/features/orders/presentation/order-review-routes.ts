import express, { type Response } from "express";
import { z } from "zod";
import { confirmOrderReviewRequestSchema, confirmOrderReviewResponseSchema, orderReviewErrorSchema } from "@shared/contracts/order-review";
import { recordLinkActionRequestSchema } from "@shared/contracts/order-link-actions";
import type { Result } from "@shared/result";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { ChangeSeq, OrderItemChangeId, OrderReviewId } from "@core/src/features/orders/domain/message-changes";
import type { OrderLinkActionId, OrderReviewProjection } from "@core/src/features/orders/domain/order-review";
import type { OrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { OrderLineQuantity } from "@core/src/features/orders/domain/order-edit";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { ConfirmOrderReviewError, ConfirmOrderReviewInput, ConfirmedReview } from "@core/src/features/orders/application/confirm-order-review";
import type { LoadOrderReviewError, LoadOrderReviewInput } from "@core/src/features/orders/application/load-order-review";
import type { RecordLinkActionError, RecordLinkActionInput } from "@core/src/features/orders/application/record-link-action";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { changeJson, toOrderReviewJson } from "@core/src/features/orders/presentation/order-review-json";

export type OrderReviewRoutesDependencies = Readonly<{
  load: (input: LoadOrderReviewInput, access: OrderAccess) => Promise<Result<OrderReviewProjection, LoadOrderReviewError>>;
  confirm: (input: ConfirmOrderReviewInput, access: OrderAccess) => Promise<Result<ConfirmedReview, ConfirmOrderReviewError>>;
  recordLinkAction: (input: RecordLinkActionInput, access: OrderAccess) => Promise<Result<null, RecordLinkActionError>>;
}>;

const orderIdSchema = z.uuid();
const querySchema = z.strictObject({ rows: z.literal("all").optional() });
const accessOf = (response: Response<unknown, PrivateLocals>): OrderAccess => ({ companyId: response.locals.auth.company.id as CompanyId, userId: response.locals.auth.user.id as UserId });
const refusal = (response: Response, status: 400 | 409 | 422, error: z.input<typeof orderReviewErrorSchema>) => response.status(status).json(orderReviewErrorSchema.parse(error));

/** Authenticated: mounted after `requireApiCompany`. `GET /:orderId/review`, `POST /:orderId/reviews` and `POST /:orderId/link-actions`. */
export function createOrderReviewRoutes(deps: OrderReviewRoutesDependencies) {
  const router = express.Router();

  router.get("/:orderId/review", async (request, response: Response<unknown, PrivateLocals>) => {
    const [id, query] = [orderIdSchema.safeParse(request.params.orderId), querySchema.safeParse(request.query)];
    if (!id.success || !query.success) return apiError(response, 400, "INVALID_INPUT", "Invalid review request");
    const loaded = await deps.load({ orderId: id.data as OrderId, allRows: query.data.rows === "all" }, accessOf(response));
    if (!loaded.success) return loaded.error.code === "ORDER_NOT_FOUND" ? apiError(response, 404, "ORDER_NOT_FOUND", "Order not found") : apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    return response.set("Cache-Control", "no-store").json(toOrderReviewJson(loaded.data));
  });

  router.post("/:orderId/reviews", async (request, response: Response<unknown, PrivateLocals>) => {
    const [id, body] = [orderIdSchema.safeParse(request.params.orderId), confirmOrderReviewRequestSchema.safeParse(request.body)];
    if (!id.success || !body.success) return refusal(response, 400, { code: "INVALID_INPUT", error: "Invalid review" });
    const { loaded } = body.data;
    const input: ConfirmOrderReviewInput = { reviewId: body.data.id as OrderReviewId, orderId: id.data as OrderId, origin: body.data.origin,
      linkAction: body.data.linkAction ? { id: body.data.linkAction.id as OrderLinkActionId, action: body.data.linkAction.action } : null,
      loaded: { changesThrough: loaded.changesThrough as ChangeSeq, changeIds: loaded.changeIds as OrderItemChangeId[], itemsRevision: loaded.itemsRevision as OrderRevision,
        points: loaded.points.map((key) => ({ pendingId: key.pendingId as never, since: new Date(key.since) })) },
      corrections: body.data.corrections.map((correction) => ({ itemId: correction.itemId as OrderItemId, quantity: correction.quantity as OrderLineQuantity | 0 })) };
    const access = accessOf(response);
    const confirmed = await deps.confirm(input, access);
    if (!confirmed.success) return confirmFailure(response, input, confirmed.error);
    const { review, order, changedMeanwhile, total, stockDue } = confirmed.data;
    const json = toOrderAggregateJson(order, stockDue);
    return response.set("Cache-Control", "no-store").json(confirmOrderReviewResponseSchema.parse({ version: 1,
      review: { id: review.id, origin: review.origin, correctedItems: review.correctedItems, confirmedAt: review.confirmedAt.toISOString() },
      order: json, changedMeanwhile: changedMeanwhile.map(changeJson), total, stockDue: json.stockDue ?? null }));
  });

  router.post("/:orderId/link-actions", async (request, response: Response<unknown, PrivateLocals>) => {
    const [id, body] = [orderIdSchema.safeParse(request.params.orderId), recordLinkActionRequestSchema.safeParse(request.body)];
    if (!id.success || !body.success) return apiError(response, 400, "INVALID_INPUT", "Invalid link action");
    const recorded = await deps.recordLinkAction({ id: body.data.id as OrderLinkActionId, orderId: id.data as OrderId, action: body.data.action }, accessOf(response));
    if (!recorded.success) return recorded.error.code === "ORDER_NOT_FOUND" ? apiError(response, 404, "ORDER_NOT_FOUND", "Order not found") : apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    return response.status(204).end();
  });
  return router;
}

function confirmFailure(response: Response<unknown, PrivateLocals>, input: ConfirmOrderReviewInput, error: ConfirmOrderReviewError) {
  const base = { companyId: response.locals.auth.company.id, orderId: input.orderId, reviewId: input.reviewId, errorCode: error.code };
  switch (error.code) {
    case "REVIEW_OUTDATED":
      log.info({ event: "order_review_outdated", ...base, newPoints: error.newPoints }, "order_review_outdated");
      return refusal(response, 409, { code: "REVIEW_OUTDATED", error: "The order changed while it was being reviewed", affectedItemIds: [...error.affectedItemIds], newPoints: error.newPoints });
    case "ORDER_CHANGED": return refusal(response, 409, { code: "ORDER_CHANGED", error: "The order changed since it was loaded" });
    case "DELIVERY_LOCKED": return refusal(response, 409, { code: "DELIVERY_LOCKED", error: "The order can no longer be edited" });
    case "ORDER_CANCELLED": return refusal(response, 409, { code: "ORDER_CANCELLED", error: "Order is cancelled" });
    case "LAST_ITEM": return refusal(response, 422, { code: "LAST_ITEM", error: "The order keeps at least one item" });
    case "VARIANT_NOT_FOUND": return refusal(response, 422, { code: "VARIANT_NOT_FOUND", error: "Variant not found", variantId: error.variantId });
    case "INVALID_INPUT":
    case "INVALID_ORDER": return refusal(response, 400, { code: "INVALID_INPUT", error: "Invalid review" });
    case "ORDER_NOT_FOUND": return apiError(response, 404, "ORDER_NOT_FOUND", "Order not found");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    default:
      log.error({ event: "order_review_failed", ...base }, "order_review_failed");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

export const orderReviewRoutes = createOrderReviewRoutes({ load: orders.loadOrderReview, confirm: orders.confirmOrderReview, recordLinkAction: orders.recordLinkAction });
