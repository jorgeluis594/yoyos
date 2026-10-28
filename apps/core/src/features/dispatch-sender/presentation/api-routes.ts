import express, { type Response } from "express";
import { dispatchSenderResponseSchema, saveDispatchSenderSchema } from "@shared/contracts/dispatch-sender";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { dispatchSender } from "@core/src/features/dispatch-sender/composition";
import type { DispatchSenderState } from "@core/src/features/dispatch-sender/domain/dispatch-sender";

export function toDispatchSenderResponse(state: DispatchSenderState) {
  return dispatchSenderResponseSchema.safeParse(state);
}

function send(response: Response, state: DispatchSenderState) {
  const body = toDispatchSenderResponse(state);
  return body.success ? response.set("Cache-Control", "no-store").json(body.data) : apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

export const dispatchSenderRoutes = express.Router();

dispatchSenderRoutes.get("/", async (_request, response: Response<unknown, PrivateLocals>) => {
  const result = await dispatchSender.get(response.locals.auth.company.id);
  if (result.success) return send(response, result.data);
  return result.error.code === "PERSISTENCE_UNAVAILABLE" ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable")
    : apiError(response, 500, "INTERNAL_ERROR", "Internal error");
});

dispatchSenderRoutes.put("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = saveDispatchSenderSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid dispatch sender");
  const { company, user } = response.locals.auth;
  const result = await dispatchSender.save(company.id, user.id, input.data);
  if (result.success) return send(response, result.data);
  switch (result.error.code) {
    case "INVALID_DISPATCH_SENDER": return apiError(response, 400, "INVALID_INPUT", "Invalid dispatch sender");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    default: return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
