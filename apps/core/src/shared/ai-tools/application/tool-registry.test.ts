import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ok } from "@shared/functional";
import { defineTool } from "@core/src/shared/ai-tools/application/tool-registry";

type Action = Readonly<{ kind: string }>;

const schema = z.object({
  product: z.string(),
  quantity: z.number().optional(),
  note: z.string().default("none"),
  price: z.object({ amount: z.number(), currency: z.string().optional() }).optional(),
  lines: z.array(z.object({ name: z.string(), size: z.string().optional() })),
});

const tool = defineTool<null, z.output<typeof schema>, Action, never>({
  name: "add_item", description: "Adds", args: { kind: "extracted" }, schema: () => schema, resolve: async (args) => ok([{ kind: JSON.stringify(args) }]),
});

type Json = Record<string, unknown>;

/** OpenAI strict function tools: additionalProperties false and every property required, at every object level. */
function strictViolations(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => strictViolations(item, `${path}[${index}]`));
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Json;
  const violations = Object.entries(node).flatMap(([key, value]) => strictViolations(value, `${path}.${key}`));
  if (node.properties && typeof node.properties === "object") {
    if (node.additionalProperties !== false) violations.push(`${path}: additionalProperties`);
    const missing = Object.keys(node.properties).filter((name) => !(node.required as string[] | undefined)?.includes(name));
    if (missing.length > 0) violations.push(`${path}: not required ${missing.join(",")}`);
  }
  return violations;
}

describe("tool registry", () => {
  test("builds a strict-mode JSON Schema from an ordinary z.object with optional fields", () => {
    const jsonSchema = tool.jsonSchema(null);
    expect(strictViolations(jsonSchema)).toEqual([]);
    expect(jsonSchema).not.toHaveProperty("$schema");
    expect((jsonSchema.properties as Json).quantity).toEqual({ anyOf: [{ type: "number" }, { type: "null" }] });
  });

  test("accepts the null the model sends for an optional field", async () => {
    const result = await tool.parseAndResolve({ product: "polo", quantity: null, note: "x", price: { amount: 3, currency: null }, lines: [{ name: "a", size: null }] }, null, new AbortController().signal);
    expect(result).toEqual(ok([{ kind: JSON.stringify({ product: "polo", note: "x", price: { amount: 3 }, lines: [{ name: "a" }] }) }]));
  });

  test("rejects registering a tool named several, reserved for the action choice", () => {
    expect(() => defineTool({ name: "several", description: "x", args: { kind: "none" }, schema: () => z.object({}), resolve: async () => ok([]) })).toThrow("Reserved tool name");
  });
});
