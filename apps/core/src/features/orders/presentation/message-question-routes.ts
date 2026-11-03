import { createHash } from "node:crypto";
import express, { type Response } from "express";
import { openQuestionsRequestSchema, openQuestionsResponseSchema } from "@shared/contracts/message-questions";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import type { Result } from "@shared/result";
import { orders } from "@core/src/features/orders/composition";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { FindOpenQuestionsError, MessageQuestions } from "@core/src/features/orders/application/find-open-questions";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
import { suggestedQuestionText } from "@core/src/features/orders/presentation/suggested-question-texts";

export type MessageQuestionRoutesDependencies = Readonly<{
  findOpenQuestions: (messageIds: readonly ChatMessageId[]) => Promise<Result<readonly MessageQuestions[], FindOpenQuestionsError>>;
}>;

/** The product name(s) a question asks about, joined with commas; empty when it names none. */
export function questionAbout(question: SuggestedQuestion): string {
  if ("product" in question) return question.product;
  if ("products" in question) return question.products.join(", ");
  return "";
}

/** A stable id for the point at `index` of a message: the same message always gives the same ids. */
export function questionPointId(messageId: string, index: number): string {
  const bytes = createHash("sha1").update(`${messageId}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Authenticated: mounted after `requireApiCompany`. `POST /api/messages/questions`: 200, 400, 503. Never cached: the answer changes with the chat. */
export function createMessageQuestionRoutes(deps: MessageQuestionRoutesDependencies) {
  const router = express.Router();
  router.post("/questions", async (request, response: Response<unknown, PrivateLocals>) => {
    const input = openQuestionsRequestSchema.safeParse(request.body);
    if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid message ids");
    const found = await deps.findOpenQuestions([...new Set(input.data.messageIds)] as ChatMessageId[]);
    if (!found.success) {
      if (found.error.code === "INVALID_INPUT") return apiError(response, 400, "INVALID_INPUT", "Invalid message ids");
      return apiError(response, 503, "SERVICE_UNAVAILABLE", "Open questions unavailable");
    }
    const body = openQuestionsResponseSchema.safeParse({
      version: 1,
      messages: found.data.map(({ messageId, questions }) => ({
        messageId,
        points: questions.map((question, index) => ({ id: questionPointId(messageId, index), text: suggestedQuestionText(question), about: questionAbout(question) })),
      })),
    });
    if (!body.success) {
      log.error({ event: "open_questions_response_invalid", errorCode: "INVALID_STORED_DATA" }, "open_questions_response_invalid");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
    return response.set("Cache-Control", "no-store").json(body.data);
  });
  return router;
}

export const messageQuestionRoutes = createMessageQuestionRoutes({ findOpenQuestions: orders.findOpenQuestions });
