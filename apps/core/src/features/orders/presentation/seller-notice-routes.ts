import express, { type Response } from "express";
import { z } from "zod";
import { sellerNoticeTargetResponseSchema } from "@shared/contracts/seller-notices";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders } from "@core/src/features/orders/composition";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

/** Authenticated: mounted after `requireApiCompany`, so the lookup already runs in the session's company. */
export const sellerNoticeRoutes = express.Router();

const messageIdSchema = z.uuid();

sellerNoticeRoutes.get("/:messageId", async (request, response: Response<unknown, PrivateLocals>) => {
  const messageId = messageIdSchema.safeParse(request.params.messageId);
  if (!messageId.success) return apiError(response, 400, "INVALID_INPUT", "Invalid message id");
  const found = await orders.findSellerNoticeTarget(messageId.data as ChatMessageId);
  if (!found.success) {
    if (found.error.code === "NOTICE_NOT_FOUND") return apiError(response, 404, "NOTICE_NOT_FOUND", "Notice not found");
    return apiError(response, 503, "SERVICE_UNAVAILABLE", "Seller notices unavailable");
  }
  const body = sellerNoticeTargetResponseSchema.safeParse({ version: 1, target: found.data });
  if (!body.success) {
    log.error({ event: "seller_notice_target_invalid", errorCode: "INVALID_STORED_DATA" }, "seller_notice_target_invalid");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.set("Cache-Control", "no-store").json(body.data);
});
