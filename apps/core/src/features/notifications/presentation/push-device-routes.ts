import express, { type Response } from "express";
import { registerPushDeviceRequestSchema, unregisterPushDeviceRequestSchema } from "@shared/contracts/push-devices";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { pushDevices } from "@core/src/features/notifications/composition";

/** Authenticated: mounted after `requireApiCompany`. */
export const pushDeviceRoutes = express.Router();

pushDeviceRoutes.put("/current", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = registerPushDeviceRequestSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid push device");
  const { auth } = response.locals;
  const result = await pushDevices.register(input.data, { userId: auth.user.id, sessionId: auth.sessionId });
  if (result.success) return response.status(204).end();
  return result.error.code === "INVALID_INPUT"
    ? apiError(response, 400, "INVALID_INPUT", "Invalid push device")
    : apiError(response, 503, "SERVICE_UNAVAILABLE", "Push devices unavailable");
});

/** Unauthenticated: the token is the proof, and the answer never says whether it existed. */
export const pushDeviceUnregisterRoutes = express.Router();

pushDeviceUnregisterRoutes.post("/unregister", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = unregisterPushDeviceRequestSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid push device");
  const result = await pushDevices.unregister(input.data.token);
  return result.success ? response.status(204).end() : apiError(response, 503, "SERVICE_UNAVAILABLE", "Push devices unavailable");
});
