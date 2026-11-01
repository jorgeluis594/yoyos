import express, { type Response } from "express";
import { z } from "zod";
import { undoMessageErrorSchema, undoMessageResponseSchema } from "@shared/contracts/order-message-undo";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import type { Result } from "@shared/result";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders } from "@core/src/features/orders/composition";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { UndoMessageError, UndoMessageInput, UndoneMessage } from "@core/src/features/orders/application/undo-message-changes";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";

export type MessageUndoRoutesDependencies = Readonly<{
  undo: (input: UndoMessageInput, access: OrderAccess) => Promise<Result<UndoneMessage, UndoMessageError>>;
  /** The review of the order after the undo; the review core replaces the minimal one the composition wires today. */
  loadReview: (order: OrderAggregate) => Promise<Result<OrderReviewResponse, Readonly<{ code: string; message: string }>>>;
}>;

const paramsSchema = z.strictObject({ orderId: z.uuid(), messageId: z.uuid() });

/** Authenticated: mounted after `requireApiCompany`. `POST /api/orders/:orderId/messages/:messageId/undo`: 200, 409 refused, 404, 503. */
export function createMessageUndoRoutes(deps: MessageUndoRoutesDependencies) {
  const router = express.Router();
  router.post("/:orderId/messages/:messageId/undo", async (request, response: Response<unknown, PrivateLocals>) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order or message id");
    const access = { companyId: response.locals.auth.company.id as CompanyId, userId: response.locals.auth.user.id as UserId };
    const input = { orderId: params.data.orderId as OrderId, messageId: params.data.messageId as ChatMessageId };
    const undone = await deps.undo(input, access);
    if (!undone.success) return undoFailure(response, input, undone.error);
    const review = await deps.loadReview(undone.data.order);
    if (!review.success) return apiError(response, 503, "SERVICE_UNAVAILABLE", "Order review unavailable");
    const body = undoMessageResponseSchema.safeParse({ order: toOrderAggregateJson(undone.data.order, null), review: review.data });
    if (!body.success) {
      log.error({ event: "order_message_undo_response_invalid", errorCode: "INVALID_STORED_DATA" }, "order_message_undo_response_invalid");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
    return response.set("Cache-Control", "no-store").json(body.data);
  });
  return router;
}

function undoFailure(response: Response<unknown, PrivateLocals>, input: UndoMessageInput, error: UndoMessageError) {
  switch (error.code) {
    case "ORDER_NOT_FOUND":
    case "MESSAGE_CHANGES_NOT_FOUND":
      return apiError(response, 404, "NOT_FOUND", "Order or message not found");
    case "UNDO_REFUSED":
      log.info({ event: "order_message_undo_refused", companyId: response.locals.auth.company.id, orderId: input.orderId, messageId: input.messageId, reason: error.reason }, "order_message_undo_refused");
      return response.status(409).json(undoMessageErrorSchema.parse({ code: "UNDO_REFUSED", error: error.message, reason: error.reason, ...(error.variantId ? { variantId: error.variantId } : {}) }));
    default:
      return apiError(response, 503, "SERVICE_UNAVAILABLE", "Undo unavailable");
  }
}

export const messageUndoRoutes = createMessageUndoRoutes({ undo: orders.undoMessage, loadReview: orders.reviewAfterUndo });
