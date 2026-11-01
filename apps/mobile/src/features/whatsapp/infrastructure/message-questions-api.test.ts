import { err, ok } from "@shared/functional";
import { openQuestionsRequestSchema } from "@shared/contracts/message-questions";
import { createMessageQuestionsApi } from "@mobile/features/whatsapp/infrastructure/message-questions-api";

const messageId = "00000000-0000-4000-8000-000000000001";
const pointId = "00000000-0000-4000-8000-000000000002";
const answer = { version: 1, messages: [{ messageId, points: [{ id: pointId, text: "¿Cuál quieres?", about: "Polo básico, Polo rojo" }] }] };

test("posts the message ids with the contract body and returns the points by message", async () => {
  const request = jest.fn(async () => ok(answer));
  const found = await createMessageQuestionsApi(request).findOpenQuestions([messageId]);
  expect(found).toEqual(ok(new Map([[messageId, [{ id: pointId, text: "¿Cuál quieres?", about: "Polo básico, Polo rojo" }]]])));
  const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/api/messages/questions");
  expect(init.method).toBe("POST");
  expect(openQuestionsRequestSchema.safeParse(JSON.parse(String(init.body))).success).toBe(true);
});

test("passes a transport failure on and rejects an answer outside the contract", async () => {
  const failure = err({ code: "NETWORK_ERROR" as const, message: "offline" });
  expect(await createMessageQuestionsApi(async () => failure).findOpenQuestions([messageId])).toEqual(failure);
  const invalid = await createMessageQuestionsApi(async () => ok({ version: 2 })).findOpenQuestions([messageId]);
  expect(invalid).toEqual(err({ code: "INVALID_RESPONSE", message: expect.any(String) }));
});

test("asks nothing when there are no messages", async () => {
  const request = jest.fn();
  expect(await createMessageQuestionsApi(request).findOpenQuestions([])).toEqual(ok(new Map()));
  expect(request).not.toHaveBeenCalled();
});
