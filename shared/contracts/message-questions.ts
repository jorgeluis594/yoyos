import { z } from "zod";

/** `POST /api/messages/questions`: 200, 400, 503. */
export const openQuestionsRequestSchema = z.strictObject({ version: z.literal(1), messageIds: z.array(z.uuid()).min(1).max(100) });
export type OpenQuestionsRequest = z.infer<typeof openQuestionsRequestSchema>;

/** `text` is the question for the buyer, rendered by core in the buyer's language; `about` names the product or item it concerns. */
export const openQuestionsResponseSchema = z.strictObject({
  version: z.literal(1),
  messages: z.array(z.strictObject({ messageId: z.uuid(), points: z.array(z.strictObject({ id: z.uuid(), text: z.string().min(1), about: z.string() })) })),
});
export type OpenQuestionsResponse = z.infer<typeof openQuestionsResponseSchema>;
