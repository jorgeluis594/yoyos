import express, { type Response } from "express";
import { createDispatchLabelsRequestSchema, createDispatchLabelsResponseSchema } from "@shared/contracts/dispatch-labels";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { dispatchLabels } from "@core/src/features/dispatch-labels/composition";

export const dispatchLabelRoutes = express.Router();

/** Web panel only (mobile prints through the Brother SDK). Read-only: the orders are never changed. */
dispatchLabelRoutes.post("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = createDispatchLabelsRequestSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid dispatch labels request");
  const result = await dispatchLabels.create(response.locals.auth.company.id, input.data);
  if (!result.success) return result.error.code === "PERSISTENCE_UNAVAILABLE"
    ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable") : apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  const body = createDispatchLabelsResponseSchema.safeParse(result.data);
  if (!body.success) {
    log.error({ event: "dispatch_labels_response_invalid", errorCode: "INVALID_STORED_DATA" }, "dispatch_labels_response_invalid");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.set("Cache-Control", "no-store").json(body.data);
});
