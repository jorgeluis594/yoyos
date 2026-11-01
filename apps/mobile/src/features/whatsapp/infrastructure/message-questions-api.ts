import { openQuestionsResponseSchema, type OpenQuestionsRequest } from "@shared/contracts/message-questions";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

/** One question box: the question for the buyer, rendered by core. */
export type QuestionPoint = Readonly<{ id: string; text: string; about: string }>;
/** The open points by core message id; a message without open points is absent. */
export type OpenQuestions = ReadonlyMap<string, readonly QuestionPoint[]>;

export function createMessageQuestionsApi(request: Request) {
  return {
    /** Core accepts 1 to 100 ids per call. */
    async findOpenQuestions(messageIds: readonly string[]): Promise<Result<OpenQuestions, TransportError>> {
      if (messageIds.length === 0) return ok(new Map());
      const body: OpenQuestionsRequest = { version: 1, messageIds: [...messageIds] };
      const raw = await request("/api/messages/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!raw.success) return raw;
      const parsed = openQuestionsResponseSchema.safeParse(raw.data);
      if (!parsed.success) return err({ code: "INVALID_RESPONSE", message: "Invalid open questions response" });
      return ok(new Map(parsed.data.messages.filter((entry) => entry.points.length > 0).map((entry) => [entry.messageId, entry.points.map(({ id, text, about }) => ({ id, text, about }))])));
    },
  } as const;
}

export type MessageQuestionsApi = ReturnType<typeof createMessageQuestionsApi>;
