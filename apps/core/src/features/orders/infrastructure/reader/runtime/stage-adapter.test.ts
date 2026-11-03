import { describe, expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { createStageAdapter } from "@core/src/features/orders/infrastructure/reader/runtime/stage-adapter";
import { createReadingDeadline } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { testVersion } from "@core/src/features/orders/infrastructure/reader/runtime/runtime-test-support";
import type { StructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";
import type { ReaderStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";

const config = (overrides: Partial<ReaderStageConfig> = {}): ReaderStageConfig => ({ stage: "intent", reading: "primary", provider: "openai", model: "gpt-6-luna", promptVersion: "intent-v1" as ReaderStageConfig["promptVersion"], timeoutMs: 10_000, ...overrides });
const usage = { inputTokens: 2_000, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: 0 };
const adapter = (model: StructuredModel, overrides: Partial<ReaderStageConfig> = {}, now = () => 0) =>
  createStageAdapter({ config: config(overrides), version: testVersion("intent", "intent-v1"), model, now });

describe("stage adapter", () => {
  test("renders the input, parses the answer and returns a call with its cost from the price table", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 7 }, usage }] });

    const result = await adapter(model)("hola", new AbortController().signal);

    expect(result).toEqual({ success: true, data: { value: 7, call: expect.objectContaining({
      stage: "intent", reading: "primary", provider: "openai", model: "gpt-6-luna", promptVersion: "intent-v1", usage, attempts: 1,
      costUsd: (2_000 * 0.1 + 100 * 0.5) / 1_000_000,
    }) } });
    expect(model.requests[0]).toMatchObject({ stage: "intent", model: "gpt-6-luna", instructions: "intent instructions", input: "input:hola", schemaName: "intent_answer", reasoningEffort: "none", maxOutputTokens: 500 });
  });

  test("has no cost for a model without a price", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 1 }, usage }] });

    const result = await adapter(model, { provider: "fake", model: "scripted" })("x", new AbortController().signal);

    expect(result).toMatchObject({ success: true, data: { call: { provider: "fake", costUsd: null } } });
  });

  test("retries an invalid stage answer once and then fails with INVALID_AI_RESPONSE", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: "x" }, usage }, { json: {}, usage }] });

    const result = await adapter(model)("x", new AbortController().signal);

    expect(model.requests).toHaveLength(2);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_AI_RESPONSE", stage: "intent", call: expect.objectContaining({ attempts: 2, usage: { ...usage, inputTokens: 4_000, outputTokens: 200 } }) }) });
  });

  test("recovers when the second answer is valid and records two attempts", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: "bad", usage }, { json: { n: 3 }, usage }] });

    const result = await adapter(model)("x", new AbortController().signal);

    expect(result).toMatchObject({ success: true, data: { value: 3, call: { attempts: 2 } } });
  });

  test("does not retry a provider failure or a deadline, which the event bus retries", async () => {
    for (const code of ["AI_PROVIDER_UNAVAILABLE", "DEADLINE_EXCEEDED"] as const) {
      const model = createFakeStructuredModel({ intent: [{ error: code }, { json: { n: 1 } }] });

      expect(await adapter(model)("x", new AbortController().signal)).toEqual({ success: false, error: expect.objectContaining({ code, call: expect.objectContaining({ attempts: 1 }) }) });
      expect(model.requests).toHaveLength(1);
    }
  });

  test("retries a model answer that was invalid JSON once", async () => {
    const model = createFakeStructuredModel({ intent: [{ error: "INVALID_AI_RESPONSE" }, { json: { n: 2 } }] });

    expect(await adapter(model)("x", new AbortController().signal)).toMatchObject({ success: true, data: { value: 2, call: { attempts: 2 } } });
  });

  test("caps a stage's timeout by what is left of the reading budget", async () => {
    let clock = 0;
    const seen: number[] = [];
    const model: StructuredModel = async (request, signal) => {
      seen.push(signal.aborted ? -1 : 1);
      return { success: true, data: { json: { n: 1 }, usage: null } };
    };
    const deadline = createReadingDeadline(15_000, {}, () => clock);
    clock = 8_000; // 7 s are left of a 10 s stage timeout
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await adapter(model, {}, () => clock)("x", deadline.signal);

    expect(timeout).toHaveBeenCalledWith(7_000);
    timeout.mockRestore();
  });

  test("keeps the stage timeout when the reading budget leaves more", async () => {
    const deadline = createReadingDeadline(60_000, {}, () => 0);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await adapter(createFakeStructuredModel({ intent: [{ json: { n: 1 } }] }))("x", deadline.signal);

    expect(timeout).toHaveBeenCalledWith(10_000);
    timeout.mockRestore();
  });

  test("does not start a stage with less than two seconds left", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 1 } }] });
    const deadline = createReadingDeadline(60_000, {}, () => 0);
    const result = await createStageAdapter({ config: config(), version: testVersion("intent", "intent-v1"), model, now: () => 58_500 })("x", deadline.signal);

    expect(result).toEqual({ success: false, error: { code: "DEADLINE_EXCEEDED", stage: "intent", call: null, message: expect.any(String) } });
    expect(model.requests).toHaveLength(0);
  });

  test("ends a stage as DEADLINE_EXCEEDED when its own timeout aborts the request", async () => {
    const model: StructuredModel = (request) => new Promise((resolve) => setTimeout(() => resolve({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE", stage: request.stage, call: null, message: "late" } }), 30));

    const result = await adapter(model, { timeoutMs: 5 })("x", new AbortController().signal);

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "DEADLINE_EXCEEDED" }) });
  });

  test("an invalid first answer with less than two seconds left ends as DEADLINE_EXCEEDED, which the event bus retries", async () => {
    let clock = 0;
    const deadline = createReadingDeadline(60_000, {}, () => clock);
    const model: StructuredModel = async () => {
      clock = 58_500;
      return { success: true, data: { json: "bad", usage: null } };
    };

    const result = await adapter(model, {}, () => clock)("x", deadline.signal);

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "DEADLINE_EXCEEDED", call: expect.objectContaining({ attempts: 1 }) }) });
  });

  test("an invalid first answer when the job signal aborts ends as DEADLINE_EXCEEDED", async () => {
    const job = new AbortController();
    const model: StructuredModel = async () => {
      job.abort();
      return { success: true, data: { json: "bad", usage: null } };
    };

    expect(await adapter(model)("x", job.signal)).toEqual({ success: false, error: expect.objectContaining({ code: "DEADLINE_EXCEEDED" }) });
  });

  test("gives the version's fallback when the answer is still invalid after the retry", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: "bad" }, { json: "worse" }] });
    const version = { ...testVersion("intent", "intent-v1"), fallback: (input: string) => input.length };

    const result = await createStageAdapter({ config: config(), version, model, now: () => 0 })("four", new AbortController().signal);

    expect(model.requests).toHaveLength(2);
    expect(result).toMatchObject({ success: true, data: { value: 4, call: { attempts: 2 } } });
  });

  test("hands the fallback the last answer's JSON, and nothing when the last attempt was not JSON", async () => {
    const seen: unknown[] = [];
    const version = { ...testVersion("intent", "intent-v1"), fallback: (_: string, lastAnswer: unknown) => { seen.push(lastAnswer); return 0; } };
    const run = (answers: Parameters<typeof createFakeStructuredModel>[0]) => createStageAdapter({ config: config(), version, model: createFakeStructuredModel(answers), now: () => 0 })("x", new AbortController().signal);

    await run({ intent: [{ json: { n: "a" } }, { json: { n: "b" } }] });
    await run({ intent: [{ json: { n: "a" } }, { error: "INVALID_AI_RESPONSE" }] });

    expect(seen).toEqual([{ n: "b" }, undefined]);
  });

  test("still fails when the fallback has no value", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: "bad" }, { json: "worse" }] });
    const version = { ...testVersion("intent", "intent-v1"), fallback: () => null };

    const result = await createStageAdapter({ config: config(), version, model, now: () => 0 })("x", new AbortController().signal);

    expect(result).toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
  });

  test("puts the company and message ids the reading carries in every stage log", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const deadline = createReadingDeadline(60_000, { companyId: "c1", messageId: "m1" }, () => 0);

    await adapter(createFakeStructuredModel({ intent: [{ json: "bad" }, { json: { n: 1 } }] }))("x", deadline.signal);
    await adapter(createFakeStructuredModel({ intent: [{ error: "AI_PROVIDER_UNAVAILABLE" }] }))("x", deadline.signal);

    const logged = [...info.mock.calls, ...warn.mock.calls].map(([fields]) => fields as Record<string, unknown>);
    expect(logged.map(({ event }) => event).sort()).toEqual(["reader_stage_completed", "reader_stage_failed", "reader_stage_retried_invalid_answer"]);
    for (const fields of logged) expect(fields).toMatchObject({ companyId: "c1", messageId: "m1" });
    expect(logged).toHaveLength(3);
    info.mockRestore();
    warn.mockRestore();
  });

  test("has no cost for the fake provider even with a priced model name", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: { n: 1 }, usage }] });

    expect(await adapter(model, { provider: "fake" })("x", new AbortController().signal)).toMatchObject({ success: true, data: { call: { costUsd: null } } });
  });
});
