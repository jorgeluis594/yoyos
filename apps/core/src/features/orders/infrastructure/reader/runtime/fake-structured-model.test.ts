import { expect, test } from "vitest";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import type { StructuredModelRequest } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

const request = (stage: StructuredModelRequest["stage"]): StructuredModelRequest => ({ stage, model: "scripted", instructions: "i", input: "x", schemaName: "s", jsonSchema: {}, reasoningEffort: "none", maxOutputTokens: 10 });
const signal = new AbortController().signal;
const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0 };

test("answers each stage with its next scripted answer, in order", async () => {
  const model = createFakeStructuredModel({ extraction: [{ json: { n: 1 }, usage }, { json: { n: 2 } }], intent: [{ json: { n: 9 } }] });

  expect(await model(request("extraction"), signal)).toEqual({ success: true, data: { json: { n: 1 }, usage } });
  expect(await model(request("intent"), signal)).toEqual({ success: true, data: { json: { n: 9 }, usage: null } });
  expect(await model(request("extraction"), signal)).toEqual({ success: true, data: { json: { n: 2 }, usage: null } });
});

test("fails with a scripted error code, and when a stage has no scripted answer left", async () => {
  const model = createFakeStructuredModel({ intent: [{ error: "AI_PROVIDER_UNAVAILABLE" }] });

  expect(await model(request("intent"), signal)).toEqual({ success: false, error: expect.objectContaining({ code: "AI_PROVIDER_UNAVAILABLE", stage: "intent", call: null }) });
  expect(await model(request("intent"), signal)).toEqual({ success: false, error: expect.objectContaining({ code: "AI_PROVIDER_UNAVAILABLE" }) });
  expect(await model(request("resolution"), signal)).toEqual({ success: false, error: expect.objectContaining({ code: "AI_PROVIDER_UNAVAILABLE" }) });
});

test("records the requests it received", async () => {
  const model = createFakeStructuredModel({ intent: [{ json: {} }] });
  await model(request("intent"), signal);

  expect(model.requests.map(({ stage, input }) => [stage, input])).toEqual([["intent", "x"]]);
});

test("is refused when NODE_ENV is production", () => {
  expect(() => createFakeStructuredModel({}, "production")).toThrow(/production/);
  expect(() => createFakeStructuredModel({}, "test")).not.toThrow();
});
