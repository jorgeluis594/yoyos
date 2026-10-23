import { describe, expect, test } from "vitest";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { defineTool, type ToolArgsSource } from "@core/src/shared/ai-tools/application/tool-registry";
import { orchestrate, type DecisionAnswers, type DecisionRequest, type ExtractionRequest, type OrchestrateDependencies } from "@core/src/shared/ai-tools/application/orchestrate";

type Context = Readonly<{ items: readonly string[] }>;
type Action = Readonly<{ kind: string }>;

const itemQuestion = (context: Context) => [{ name: "item", instructions: "Which item?", choices: context.items.map((value) => ({ value })) }];

function fakeTool(name: string, args: ToolArgsSource<Context>, schema: z.ZodType = z.object({})) {
  return defineTool<Context, unknown, Action, never>({ name, description: `Does ${name}`, schema: () => schema, args, resolve: async () => ok([{ kind: name }]) });
}

const ready = fakeTool("mark_order_ready", { kind: "none" });
const remove = fakeTool("remove_item", { kind: "decision", questions: itemQuestion }, z.object({ item: z.object({ value: z.string(), confidence: z.number() }) }));
const add = fakeTool("add_item", { kind: "extracted" }, z.object({ product: z.string() }));
const setPrice = fakeTool("set_item_mentioned_price", { kind: "extracted", questions: itemQuestion },
  z.object({ item: z.object({ value: z.string(), confidence: z.number() }), price: z.number() }));
const tools = [ready, remove, add, setPrice];
const context: Context = { items: ["A", "B"] };
const parts = [{ kind: "text", text: "quita la gorra" }] as const;

type Reply = Readonly<{ action: string; confidence?: number; predicates?: Record<string, number>; choices?: Record<string, DecisionAnswers["choices"][string]> }>;

function setup(reply: Reply, extracted: readonly { tool: string; args: unknown }[] = []) {
  const decisions: DecisionRequest[] = [];
  const extractions: ExtractionRequest[] = [];
  const deps: OrchestrateDependencies = {
    minActionConfidence: 0.6, minToolPredicate: 0.5,
    decide: async (request) => {
      decisions.push(request);
      return ok({ action: { choice: reply.action, confidence: reply.confidence ?? 0.9 },
        predicates: Object.fromEntries(request.predicates.map(({ tool }) => [tool, reply.predicates?.[tool] ?? 0])),
        choices: reply.choices ?? {} });
    },
    extract: async (request) => { extractions.push(request); return ok(extracted); },
  };
  const run = (offered = tools) => orchestrate({ messageParts: parts, contextText: "Order: A, B", context, tools: offered }, deps, new AbortController().signal);
  return { run, decisions, extractions };
}

describe("orchestrate", () => {
  test("returns the chosen tool with decision arguments when it needs no extraction", async () => {
    const { run, extractions } = setup({ action: "remove_item", choices: { "remove_item:item": { value: "A", confidence: 0.95 } } });
    const plan = await run();
    expect(plan).toEqual({ success: true, data: { kind: "calls", extraction: false, calls: [{ tool: "remove_item", args: { item: { value: "A", confidence: 0.95 } } }] } });
    expect(extractions).toEqual([]);
  });

  test("returns a tool without arguments as a call with empty arguments", async () => {
    const { run, extractions } = setup({ action: "mark_order_ready" });
    expect(await run()).toEqual({ success: true, data: { kind: "calls", extraction: false, calls: [{ tool: "mark_order_ready", args: {} }] } });
    expect(extractions).toEqual([]);
  });

  test("asks the extraction model only for the chosen tool when its arguments are extracted", async () => {
    const { run, extractions } = setup({ action: "add_item" }, [{ tool: "add_item", args: { product: "gorra" } }]);
    const plan = await run();
    expect(plan).toEqual({ success: true, data: { kind: "calls", extraction: true, calls: [{ tool: "add_item", args: { product: "gorra" } }] } });
    expect(extractions).toHaveLength(1);
    expect(extractions[0]!.tools.map(({ name }) => name)).toEqual(["add_item"]);
  });

  test("selects tools by predicate for several actions and extracts only the extracted ones", async () => {
    const { run, extractions } = setup({ action: "several", predicates: { mark_order_ready: 0.9, remove_item: 0.8, add_item: 0.7, set_item_mentioned_price: 0.1 },
      choices: { "remove_item:item": { value: "B", confidence: 0.9 } } }, [{ tool: "add_item", args: { product: "polo" } }]);
    const plan = await run();
    expect(plan.success && plan.data).toEqual({ kind: "calls", extraction: true, calls: [
      { tool: "mark_order_ready", args: {} },
      { tool: "remove_item", args: { item: { value: "B", confidence: 0.9 } } },
      { tool: "add_item", args: { product: "polo" } },
    ] });
    expect(extractions[0]!.tools.map(({ name }) => name)).toEqual(["add_item"]);
  });

  test("makes no extraction when several actions select only none and decision tools", async () => {
    const { run, extractions } = setup({ action: "several", predicates: { mark_order_ready: 0.9, remove_item: 0.8 }, choices: { "remove_item:item": { value: "A", confidence: 0.9 } } });
    const plan = await run();
    expect(plan.success && plan.data.kind === "calls" && plan.data.extraction).toBe(false);
    expect(extractions).toEqual([]);
  });

  test("returns ambiguous when the action confidence is below the minimum", async () => {
    const { run, extractions } = setup({ action: "add_item", confidence: 0.59 });
    expect(await run()).toEqual({ success: true, data: { kind: "ambiguous" } });
    expect(extractions).toEqual([]);
  });

  test("returns ambiguous when several actions select fewer than two tools", async () => {
    const { run, extractions } = setup({ action: "several", predicates: { add_item: 0.9, remove_item: 0.49 } });
    expect(await run()).toEqual({ success: true, data: { kind: "ambiguous" } });
    expect(extractions).toEqual([]);
  });

  test("merges an extracted tool's decision answers into the extraction model's arguments", async () => {
    const { run, extractions } = setup({ action: "set_item_mentioned_price", choices: { "set_item_mentioned_price:item": { value: "B", confidence: 0.92 } } },
      [{ tool: "set_item_mentioned_price", args: { price: 35 } }]);
    const plan = await run();
    expect(plan.success && plan.data).toEqual({ kind: "calls", extraction: true, calls: [{ tool: "set_item_mentioned_price", args: { price: 35, item: { value: "B", confidence: 0.92 } } }] });
    const schema = extractions[0]!.tools[0]!.jsonSchema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(["price"]);
    expect(schema.required).toEqual(["price"]);
  });

  test("never offers tools outside the registry subset given for the message", async () => {
    const { run, decisions } = setup({ action: "mark_order_ready" });
    await run([ready, add]);
    const request = decisions[0]!;
    expect(request.action.choices.map(({ value }) => value)).toEqual(["mark_order_ready", "add_item", "several"]);
    expect(request.predicates.map(({ tool }) => tool)).toEqual(["mark_order_ready", "add_item"]);
    expect(request.choices).toEqual([]);
  });

  test("asks the questions of every offered tool that declares them", async () => {
    const { run, decisions } = setup({ action: "mark_order_ready" });
    await run();
    expect(decisions[0]!.choices.map(({ id }) => id)).toEqual(["remove_item:item", "set_item_mentioned_price:item"]);
  });

  test("rejects a decision that chooses a tool that was not offered", async () => {
    const { run } = setup({ action: "add_item" });
    expect(await run([ready, remove])).toEqual({ success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } });
  });

  test("rejects a decision missing the answer to a selected tool's question", async () => {
    const { run } = setup({ action: "remove_item" });
    expect(await run()).toEqual({ success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } });
  });

  test("rejects extraction output that is empty", async () => {
    const { run } = setup({ action: "add_item" }, []);
    expect(await run()).toEqual({ success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } });
  });

  test("rejects an extraction that skips one of the several requested extracted tools", async () => {
    const { run } = setup({ action: "several", predicates: { add_item: 0.9, set_item_mentioned_price: 0.9 } }, [{ tool: "add_item", args: { product: "polo" } }]);
    expect(await run()).toEqual({ success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } });
  });

  test("returns the provider failure of the decision or extraction call", async () => {
    const unavailable = { code: "AI_PROVIDER_UNAVAILABLE", message: "down" } as const;
    const deps: OrchestrateDependencies = { minActionConfidence: 0.6, minToolPredicate: 0.5, decide: async () => err(unavailable), extract: async () => err(unavailable) };
    const signal = new AbortController().signal;
    expect(await orchestrate({ messageParts: parts, contextText: "", context, tools }, deps, signal)).toEqual(err(unavailable));
    const extractOnly: OrchestrateDependencies = { ...deps, decide: async () => ok({ action: { choice: "add_item", confidence: 1 }, predicates: {}, choices: {} }) };
    expect(await orchestrate({ messageParts: parts, contextText: "", context, tools }, extractOnly, signal)).toEqual(err(unavailable));
  });
});
