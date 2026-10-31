import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import {
  answerToolCall, type AnswerToolCallDependencies, type RegisteredTool, type ToolRun,
} from "@core/src/features/assistants/application/answer-tool-call";

const now = new Date("2026-10-30T12:00:30.000Z");
const companyId = "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId;
const access: AssistantAccess = {
  companyId, userId: "user-1" as UserId, connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId,
  scopes: ["orders:read"], lastUsedAt: new Date("2026-10-30T11:00:00.000Z"),
};

type Input = { texto?: string };
function tool(run: (input: Input, access: AssistantAccess) => Promise<ToolRun<{ total: number }>>): RegisteredTool<Input, { total: number }> {
  return {
    name: "buscar_pedidos", title: "Buscar pedidos", description: "d",
    inputSchema: z.strictObject({ texto: z.string().max(5, "Usa 5 caracteres o menos.").optional() }),
    outputSchema: z.strictObject({ total: z.number() }), sampleOutputs: [{ total: 1 }], run,
  };
}

function dependencies(overrides: Partial<AnswerToolCallDependencies> = {}): AnswerToolCallDependencies {
  return { allowCall: () => ({ allowed: true }), touchConnection: vi.fn(async () => ok(null)), clock: () => now, ...overrides };
}

describe("answerToolCall", () => {
  test("answers with the tool output", async () => {
    const answer = await answerToolCall(tool(async () => ok({ output: { total: 3 }, empty: false })), { texto: "abc" }, access, dependencies());
    expect(answer).toEqual({ outcome: "answered", output: { total: 3 } });
  });

  test("marks an empty result as empty without turning it into a failure", async () => {
    const answer = await answerToolCall(tool(async () => ok({ output: { total: 0 }, empty: true })), {}, access, dependencies());
    expect(answer).toEqual({ outcome: "empty", output: { total: 0 } });
  });

  test("checks the store limit before updating last use and still updates it on a refused call", async () => {
    const order: string[] = [];
    const answer = await answerToolCall(tool(async () => ok({ output: { total: 1 }, empty: false })), {}, access, dependencies({
      allowCall: (company) => { order.push(`allow:${company}`); return { allowed: false, retryAfterSeconds: 23 }; },
      touchConnection: async () => { order.push("touch"); return ok(null); },
    }));
    expect(answer).toEqual({ outcome: "rate_limited", retryAfterSeconds: 23 });
    expect(order).toEqual([`allow:${companyId}`, "touch"]);
  });

  test("does not run the tool when the limit refuses the call", async () => {
    const run = vi.fn(async () => ok({ output: { total: 1 }, empty: false }));
    await answerToolCall(tool(run), {}, access, dependencies({ allowCall: () => ({ allowed: false, retryAfterSeconds: 5 }) }));
    expect(run).not.toHaveBeenCalled();
  });

  test("skips the last use write when it was already written this minute", async () => {
    const touchConnection = vi.fn(async () => ok(null));
    await answerToolCall(tool(async () => ok({ output: { total: 1 }, empty: false })), {}, { ...access, lastUsedAt: new Date("2026-10-30T12:00:05.000Z") }, dependencies({ touchConnection }));
    expect(touchConnection).not.toHaveBeenCalled();
    await answerToolCall(tool(async () => ok({ output: { total: 1 }, empty: false })), {}, { ...access, lastUsedAt: null }, dependencies({ touchConnection }));
    expect(touchConnection).toHaveBeenCalledWith(access.connectionId, now);
  });

  test("updates last use when the input is invalid", async () => {
    const touchConnection = vi.fn(async () => ok(null));
    const run = vi.fn(async () => ok({ output: { total: 1 }, empty: false }));
    const answer = await answerToolCall(tool(run), { texto: "demasiado largo" }, access, dependencies({ touchConnection }));
    expect(touchConnection).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ outcome: "invalid_input" });
    expect((answer as { message: string }).message).toContain("texto");
    expect((answer as { message: string }).message).toContain("Usa 5 caracteres o menos.");
  });

  test("refuses an input that is not an object or has unknown fields", async () => {
    const run = vi.fn(async () => ok({ output: { total: 1 }, empty: false }));
    expect(await answerToolCall(tool(run), "texto", access, dependencies())).toMatchObject({ outcome: "invalid_input" });
    expect(await answerToolCall(tool(run), { texto: "a", extra: 1 }, access, dependencies())).toMatchObject({ outcome: "invalid_input" });
    expect(run).not.toHaveBeenCalled();
  });

  test("a failed last use write does not refuse the call", async () => {
    const answer = await answerToolCall(tool(async () => ok({ output: { total: 1 }, empty: false })), {}, { ...access, lastUsedAt: null },
      dependencies({ touchConnection: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) }));
    expect(answer).toMatchObject({ outcome: "answered" });
  });

  test("maps not found, tool-detected invalid input and reading failures to their outcomes", async () => {
    const notFound = await answerToolCall(tool(async () => err({ code: "NOT_FOUND", message: "No hay un pedido #7 en tu tienda." })), {}, access, dependencies());
    expect(notFound).toEqual({ outcome: "not_found", message: "No hay un pedido #7 en tu tienda." });
    const invalid = await answerToolCall(tool(async () => err({ code: "INVALID_INPUT", message: "Ese courier no existe." })), {}, access, dependencies());
    expect(invalid).toEqual({ outcome: "invalid_input", message: "Ese courier no existe." });
  });

  test("maps a reading failure to failure, never to an empty answer", async () => {
    const failed = await answerToolCall(tool(async () => err({ code: "FAILURE", message: "No pudimos leer tus pedidos." })), {}, access, dependencies());
    expect(failed).toEqual({ outcome: "failure", message: "No pudimos leer tus pedidos." });
    const thrown = new Error("boom");
    const crashed = await answerToolCall(tool(async () => { throw thrown; }), {}, access, dependencies());
    expect(crashed).toEqual({ outcome: "failure", message: null, cause: thrown });
  });
});
