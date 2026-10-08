import express, { type Response } from "express";
import { registerWhatsAppMessageRequestSchema, registerWhatsAppMessageResponseSchema } from "@shared/contracts/whatsapp-messages";
import type { Result } from "@shared/result";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { hasDuplicateJsonKeys } from "@core/src/shared/presentation/json-keys";
import { toMobileMessageInput } from "@core/src/features/chats/presentation/mobile-message-schemas";
import type { CompanyId, MobileMessageInput, RegisterMobileMessageError, RegisterOutcome, RegistrationContext } from "@core/src/features/chats/domain/mobile-message";
import { log } from "@core/src/shared/infrastructure/logger";

export type RegisterMobileMessage = (message: MobileMessageInput, context: RegistrationContext) => Promise<Result<RegisterOutcome, RegisterMobileMessageError>>;

export const mobileMessageParser = express.Router();
mobileMessageParser.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
mobileMessageParser.use((request, response, next) => {
  if (!request.is("application/json") || ![undefined, "identity"].includes(request.headers["content-encoding"]))
    return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported media type");
  return next();
});
mobileMessageParser.use(express.json({ limit: 102400, inflate: false, verify: (_request, _response, body, encoding) => {
  if (encoding !== "utf-8") throw Object.assign(new Error("Unsupported charset"), { type: "charset.unsupported" });
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
    JSON.parse(raw);
  } catch { throw new Error("INVALID_JSON"); }
  if (hasDuplicateJsonKeys(raw)) throw new Error("DUPLICATE_KEY");
} }));
mobileMessageParser.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.too.large") return apiError(response, 413, "PAYLOAD_TOO_LARGE", "Payload too large");
    if (error.type === "encoding.unsupported" || error.type === "charset.unsupported") return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported media type");
    if (error.type === "entity.verify.failed") return apiError(response, 400, "INVALID_INPUT", "Invalid input", [{ field: "body", reason: "message" in error && error.message === "INVALID_JSON" ? "INVALID_JSON" : "DUPLICATE_KEY" }]);
    if (error.type === "entity.parse.failed") return apiError(response, 400, "INVALID_INPUT", "Invalid input", [{ field: "body", reason: "INVALID_JSON" }]);
  }
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
});

export function mobileMessageRoutes(register: RegisterMobileMessage) {
  const router = express.Router();
  router.post("/", async (request, response: Response<unknown, PrivateLocals>) => {
    const parsed = registerWhatsAppMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join(".") : "body",
        reason: issue.message === "IDENTITY_MISMATCH" ? "IDENTITY_MISMATCH" : issue.code === "unrecognized_keys" ? "UNKNOWN_FIELD" : "INVALID_VALUE",
      }));
      return apiError(response, 400, "INVALID_INPUT", "Invalid input", issues);
    }
    try {
      const result = await register(toMobileMessageInput(parsed.data), {
        companyId: response.locals.auth.company.id as CompanyId,
        uploadedByUserId: response.locals.auth.user.id,
      });
      if (!result.success) return result.error.code === "PERSISTENCE_UNAVAILABLE" || result.error.code === "EVENT_BUS_UNAVAILABLE"
        ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable")
        : apiError(response, 500, "INTERNAL_ERROR", "Internal error");
      const output = registerWhatsAppMessageResponseSchema.safeParse({
        status: result.data.status,
        messageId: result.data.messageId,
        eventId: result.data.eventId,
        receivedAt: result.data.receivedAt.toISOString(),
      });
      if (!output.success) return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
      return response.status(output.data.status === "stored" ? 201 : 200).json(output.data);
    } catch {
      log.error({ event: "mobile_message_api_failed", errorCode: "UNEXPECTED" }, "Mobile message API failed");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  });
  return router;
}
