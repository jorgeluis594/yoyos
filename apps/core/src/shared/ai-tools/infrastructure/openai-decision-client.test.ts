import OpenAI from "openai";
import { describe, expect, test } from "vitest";
import type { DecisionRequest } from "@core/src/shared/ai-tools/application/orchestrate";
import { createOpenAiDecisionClient } from "@core/src/shared/ai-tools/infrastructure/openai-decision-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const request: DecisionRequest = {
  contextText: "Order: A, B",
  messageParts: [{ kind: "text", text: "quita la gorra" }],
  action: { instructions: "Pick", choices: [{ value: "remove_item", description: "Removes" }, { value: "several", description: "More" }] },
  predicates: [{ tool: "remove_item", instructions: "Does it remove?" }],
  choices: [{ id: "remove_item:item", instructions: "Which?", choices: [{ value: "A" }, { value: "B" }] }],
};
const answers = [
  { type: "choice", name: "action", choice: "remove_item", confidence: 0.9, probabilities: [] },
  { type: "predicate", name: "predicate:remove_item", probability: 0.8 },
  { type: "choice", name: "choice:remove_item:item", choice: "B", confidence: 0.95, probabilities: [] },
];

function decide(respond: (init: RequestInit | undefined) => Promise<Response>, timeoutMs = 50) {
  const bodies: unknown[] = [];
  const client = new OpenAI({ apiKey: "test-key", fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return respond(init); } });
  return { decide: createOpenAiDecisionClient({ client, timeoutMs }), bodies };
}
const hangUntilAborted = (init: RequestInit | undefined) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
const code = (result: { success: boolean; error?: { code: string } }) => result.error?.code;

describe("createOpenAiDecisionClient", () => {
  test("sends the action, predicates and choices as questions and maps the answers by name", async () => {
    const { decide: run, bodies } = decide(async () => json({ model: "gpt-6-luna", usage: { input_tokens: 5, output_tokens: 1 }, answers }));
    const result = await run(request, new AbortController().signal);
    expect(result).toEqual({ success: true, data: { action: { choice: "remove_item", confidence: 0.9 }, predicates: { remove_item: 0.8 }, choices: { "remove_item:item": { value: "B", confidence: 0.95 } } } });
    const body = bodies[0] as { model: string; questions: { name: string; type: string }[] };
    expect(body.model).toBe("gpt-6-luna");
    expect(Object.keys(body).sort()).toEqual(["input", "model", "questions"]);
    expect(body.questions.map(({ name, type }) => `${type}:${name}`)).toEqual(["choice:action", "predicate:predicate:remove_item", "choice:choice:remove_item:item"]);
  });

  test("maps timeout, network, 429 and 5xx to AI provider unavailable", async () => {
    for (const respond of [hangUntilAborted, () => Promise.reject(new TypeError("fetch failed")), async () => json({ error: { message: "x" } }, 429), async () => json({ error: { message: "x" } }, 503)]) {
      const result = await decide(respond).decide(request, new AbortController().signal);
      expect(code(result)).toBe("AI_PROVIDER_UNAVAILABLE");
    }
  });

  test("maps an abort at the deadline to deadline exceeded", async () => {
    const controller = new AbortController();
    const pending = decide(hangUntilAborted, 5_000).decide(request, controller.signal);
    controller.abort();
    expect(code(await pending)).toBe("DEADLINE_EXCEEDED");
  });

  test("maps a refused action, a missing answer or an unknown choice to invalid AI response", async () => {
    const refusal = [{ type: "refusal", name: "action" }];
    const unknownChoice = answers.map((answer) => answer.name === "action" ? { ...answer, choice: "launch_missiles" } : answer);
    const unknownItem = answers.map((answer) => answer.name === "choice:remove_item:item" ? { ...answer, choice: "Z" } : answer);
    for (const body of [refusal, unknownChoice, unknownItem, answers.slice(0, 2)]) {
      const result = await decide(async () => json({ model: "gpt-6-luna", usage: {}, answers: body })).decide(request, new AbortController().signal);
      expect(code(result)).toBe("INVALID_AI_RESPONSE");
    }
  });

  test("counts a refused predicate as 0 and leaves a refused choice unanswered instead of failing the decision", async () => {
    const refused = answers.map((answer) => answer.name === "action" ? answer : { type: "refusal", name: answer.name });
    const result = await decide(async () => json({ model: "gpt-6-luna", usage: {}, answers: refused })).decide(request, new AbortController().signal);
    expect(result).toEqual({ success: true, data: { action: { choice: "remove_item", confidence: 0.9 }, predicates: { remove_item: 0 }, choices: {} } });
  });

  test("maps other 4xx to invalid AI response", async () => {
    expect(code(await decide(async () => json({ error: { message: "bad" } }, 400)).decide(request, new AbortController().signal))).toBe("INVALID_AI_RESPONSE");
  });
});
