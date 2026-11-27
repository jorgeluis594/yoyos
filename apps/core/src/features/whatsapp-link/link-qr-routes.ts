import express, { type Response } from "express";
import { shareLinkQrRequestSchema } from "@shared/contracts/whatsapp-link-qr";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import type { LinkQrHub } from "@core/src/features/whatsapp-link/link-qr-hub";

/** Authenticated: mounted after `requireApiCompany`, so the QR is relayed only to the session's company. */
export function linkQrRoutes(hub: LinkQrHub) {
  const routes = express.Router();
  routes.put("/", (request, response: Response<unknown, PrivateLocals>) => {
    const body = shareLinkQrRequestSchema.safeParse(request.body);
    if (!body.success) return apiError(response, 400, "INVALID_INPUT", "Invalid QR", body.error.issues);
    hub.share(response.locals.auth.company.id, body.data.qr);
    return response.status(204).end();
  });
  return routes;
}
