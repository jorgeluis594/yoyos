import { describe, expect, test, vi } from "vitest";
import { createStageAdapter } from "@core/src/features/orders/infrastructure/reader/runtime/stage-adapter";
import { createReadingDeadline } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { testVersion } from "@core/src/features/orders/infrastructure/reader/runtime/runtime-test-support";
import type { StructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";
import type { ReaderStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";

const config = (overrides: Partial<ReaderStageConfig> = {}): ReaderStageConfig => ({ stage: "intent", reading: "primary", provider: "openai", model: "gpt-6-luna", promptVersion: "intent-v1" as ReaderStageConfig["promptVersion"], timeoutMs: 10_000, ...overrides });
const meta = { companyId: "company", messageId: "message" };
const usage = { inputTokens: 2_000, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: 0 };
const adapter = (model: StructuredModel, overrides: Partial<ReaderStageConfig> = {}, now = () => 0) =>
  createStageAdapter({ config: config(overrides), version: testVersion("intent", "intent-v1"), model, now });

describe("stage adapter", () => {
  test("renders the input, parses the answer and returns a call with its cost from the price table", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 7 }, usage }] });

    const result = await adapter(model)("hola", new AbortController().signal, meta);

    expect(result).toEqual({ success: true, data: { value: 7, call: expect.objectContaining({
      stage: "intent", reading: "primary", provider: "openai", model: "gpt-6-luna", promptVersion: "intent-v1", usage, attempts: 1,
      costUsd: (2_000 * 0.1 + 100 * 0.5) / 1_000_000,
    }) } });
    expect(model.requests[0]).toMatchObject({ stage: "intent", model: "gpt-6-luna", instructions: "intent instructions", input: "input:hola", schemaName: "intent_answer", reasoningEffort: "none", maxOutputTokens: 500 });
  });

  test("has no cost for a model without a price", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 1 }, usage }] });

    const result = await adapter(model, { provider: "fake", model: "scripted" })("x", new AbortController().signal, meta);

    expect(result).toMatchObject({ success: true, data: { call: { provider: "fake", costUsd: null } } });
  });

  test("retries an invalid stage answer once and then fails with INVALID_AI_RESPONSE", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: "x" }, usage }, { json: {}, usage }] });

    const result = await adapter(model)("x", new AbortController().signal, meta);

    expect(model.requests).toHaveLength(2);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_AI_RESPONSE", stage: "intent", call: expect.objectContaining({ attempts: 2, usage: { ...usage, inputTokens: 4_000, outputTokens: 200 } }) }) });
  });

  test("recovers when the second answer is valid and records two attempts", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: "bad", usage }, { json: { n: 3 }, usage }] });

    const result = await adapter(model)("x", new AbortController().signal, meta);

    expect(result).toMatchObject({ success: true, data: { value: 3, call: { attempts: 2 } } });
  });

  test("does not retry a provider failure or a deadline, which the event bus retries", async () => {
    for (const code of ["AI_PROVIDER_UNAVAILABLE", "DEADLINE_EXCEEDED"] as const) {
      const model = createFakeStructuredModel({ intent: [{ error: code }, { json: { n: 1 } }] });

      expect(await adapter(model)("x", new AbortController().signal, meta)).toEqual({ success: false, error: expect.objectContaining({ code, call: expect.objectContaining({ attempts: 1 }) }) });
      expect(model.requests).toHaveLength(1);
    }
  });

  test("retries a model answer that was invalid JSON once", async () => {
    const model = createFakeStructuredModel({ intent: [{ error: "INVALID_AI_RESPONSE" }, { json: { n: 2 } }] });

    expect(await adapter(model)("x", new AbortController().signal, meta)).toMatchObject({ success: true, data: { value: 2, call: { attempts: 2 } } });
  });

  test("caps a stage's timeout by what is left of the reading budget", async () => {
    let clock = 0;
    const seen: number[] = [];
    const model: StructuredModel = async (request, signal) => {
      seen.push(signal.aborted ? -1 : 1);
      return { success: true, data: { json: { n: 1 }, usage: null } };
    };
    const deadline = createReadingDeadline(15_000, () => clock);
    clock = 8_000; // 7 s are left of a 10 s stage timeout
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await adapter(model, {}, () => clock)("x", deadline.signal, meta);

    expect(timeout).toHaveBeenCalledWith(7_000);
    timeout.mockRestore();
  });

  test("keeps the stage timeout when the reading budget leaves more", async () => {
    const deadline = createReadingDeadline(60_000, () => 0);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await adapter(createFakeStructuredModel({ intent: [{ json: { n: 1 } }] }))("x", deadline.signal, meta);

    expect(timeout).toHaveBeenCalledWith(10_000);
    timeout.mockRestore();
  });

  test("does not start a stage with less than two seconds left", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 1 } }] });
    const deadline = createReadingDeadline(60_000, () => 0);
    const result = await createStageAdapter({ config: config(), version: testVersion("intent", "intent-v1"), model, now: () => 58_500 })("x", deadline.signal, meta);

    expect(result).toEqual({ success: false, error: { code: "DEADLINE_EXCEEDED", stage: "intent", call: null, message: expect.any(String) } });
    expect(model.requests).toHaveLength(0);
  });

  test("ends a stage as DEADLINE_EXCEEDED when its own timeout aborts the request", async () => {
    const model: StructuredModel = (request) => new Promise((resolve) => setTimeout(() => resolve({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE", stage: request.stage, call: null, message: "late" } }), 30));

    const result = await adapter(model, { timeoutMs: 5 })("x", new AbortController().signal, meta);

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "DEADLINE_EXCEEDED" }) });
  });
});
