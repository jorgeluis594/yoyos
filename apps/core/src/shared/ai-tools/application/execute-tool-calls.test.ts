import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { defineTool, defineToolRegistry } from "@core/src/shared/ai-tools/application/tool-registry";
import { executeToolCalls } from "@core/src/shared/ai-tools/application/execute-tool-calls";

type Context = Readonly<{ max: number }>;
type Action = Readonly<{ kind: string; amount?: number }>;
type DomainError = Readonly<{ code: "BOOM"; message: string }>;

const setAmount = defineTool<Context, { amount: number }, Action, DomainError>({
  name: "set_amount", description: "Sets an amount", args: { kind: "extracted" },
  schema: (context) => z.object({ amount: z.number().max(context.max) }),
  resolve: async ({ amount }) => ok([{ kind: "set_amount", amount }]),
});
const twice = defineTool<Context, Record<string, never>, Action, DomainError>({
  name: "twice", description: "Emits two actions", args: { kind: "none" }, schema: () => z.object({}),
  resolve: async () => ok([{ kind: "first" }, { kind: "second" }]),
});
const failing = defineTool<Context, Record<string, never>, Action, DomainError>({
  name: "failing", description: "Fails", args: { kind: "none" }, schema: () => z.object({}),
  resolve: async () => err({ code: "BOOM", message: "boom" }),
});
const registry = defineToolRegistry([setAmount, twice, failing]);
const context: Context = { max: 10 };
const signal = new AbortController().signal;
const plan = (...calls: { tool: string; args: unknown }[]) => ({ kind: "calls", extraction: false, calls: calls as [typeof calls[0], ...typeof calls] }) as const;

describe("executeToolCalls", () => {
  test("rejects a call to an unknown tool as an invalid AI response", async () => {
    const run = vi.fn();
    const result = await executeToolCalls({ plan: plan({ tool: "launch_missiles", args: {} }), registry, context, signal, run });
    expect(result).toEqual({ success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } });
    expect(run).not.toHaveBeenCalled();
  });

  test("rejects arguments that do not match the tool schema built from the context", async () => {
    const run = vi.fn();
    const result = await executeToolCalls({ plan: plan({ tool: "set_amount", args: { amount: 11 } }), registry, context, signal, run });
    expect(result).toEqual({ success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } });
    expect(run).not.toHaveBeenCalled();
    const accepted = await executeToolCalls({ plan: plan({ tool: "set_amount", args: { amount: 11 } }), registry, context: { max: 20 }, signal, run: async (actions) => ok(actions) });
    expect(accepted.success).toBe(true);
  });

  test("passes the actions of every call, in order, to run", async () => {
    const run = vi.fn(async (actions: readonly Action[]) => ok(actions.length));
    const result = await executeToolCalls({ plan: plan({ tool: "twice", args: {} }, { tool: "set_amount", args: { amount: 3 } }), registry, context, signal, run });
    expect(result).toEqual(ok(3));
    expect(run).toHaveBeenCalledWith([{ kind: "first" }, { kind: "second" }, { kind: "set_amount", amount: 3 }]);
  });

  test("does not call run when a resolve step fails", async () => {
    const run = vi.fn();
    const result = await executeToolCalls({ plan: plan({ tool: "twice", args: {} }, { tool: "failing", args: {} }), registry, context, signal, run });
    expect(result).toEqual(err({ code: "BOOM", message: "boom" }));
    expect(run).not.toHaveBeenCalled();
  });

  test("returns the failure of run", async () => {
    const result = await executeToolCalls({ plan: plan({ tool: "twice", args: {} }), registry, context, signal, run: async () => err({ code: "RUN_FAILED", message: "no" }) });
    expect(result).toEqual(err({ code: "RUN_FAILED", message: "no" }));
  });

  test("rejects a registry with duplicate tool names", () => {
    expect(() => defineToolRegistry([twice, twice])).toThrow(/twice/);
  });

  test("rejects a tool name outside the allowed pattern", () => {
    expect(() => defineTool({ name: "Bad-Name", description: "x", args: { kind: "none" }, schema: () => z.object({}), resolve: async () => ok([]) })).toThrow(/Bad-Name/);
  });
});
