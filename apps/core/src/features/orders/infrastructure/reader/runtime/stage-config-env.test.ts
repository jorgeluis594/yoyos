import { describe, expect, test } from "vitest";
import { readReadingBudgetMs, readStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";
import type { PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { testVersion } from "@core/src/features/orders/infrastructure/reader/runtime/runtime-test-support";

const registry = {
  intent: { "intent-v1": testVersion("intent", "intent-v1") },
  extraction: { "extraction-v1": testVersion("extraction", "extraction-v1"), "extraction-v2": testVersion("extraction", "extraction-v2") },
  resolution: { "resolution-v1": testVersion("resolution", "resolution-v1") },
} as unknown as PromptRegistry;

const config = (env: Record<string, string>, stage: "intent" | "extraction" | "resolution" = "intent", reading: "primary" | "confirming" = "primary") =>
  readStageConfig(env, stage, reading, registry);

describe("stage configuration from the env", () => {
  test("defaults every stage to OpenAI gpt-6-luna with its first prompt version and a 10 s timeout", () => {
    expect(config({})).toEqual({ success: true, data: { stage: "intent", reading: "primary", provider: "openai", model: "gpt-6-luna", promptVersion: "intent-v1", timeoutMs: 10_000 } });
  });

  test("reads the provider, model, prompt and timeout of one stage and ignores empty values", () => {
    const env = { READER_EXTRACTION_PROVIDER: "fake", READER_EXTRACTION_MODEL: "scripted", READER_EXTRACTION_PROMPT: "extraction-v2", READER_STAGE_TIMEOUT_MS: "4000", READER_INTENT_MODEL: "" };

    expect(config(env, "extraction")).toEqual({ success: true, data: { stage: "extraction", reading: "primary", provider: "fake", model: "scripted", promptVersion: "extraction-v2", timeoutMs: 4000 } });
    expect(config(env, "intent")).toMatchObject({ success: true, data: { provider: "openai", model: "gpt-6-luna" } });
  });

  test("refuses to start with an unknown prompt version, naming the stage and the version", () => {
    const result = config({ READER_INTENT_PROMPT: "intent-v9" });

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "UNKNOWN_PROMPT_VERSION", message: expect.stringContaining("intent") }) });
    expect(!result.success && result.error.message).toContain("intent-v9");
  });

  test("refuses a prompt version registered for another stage", () => {
    expect(config({ READER_INTENT_PROMPT: "extraction-v1" }).success).toBe(false);
  });

  test("refuses to start with an OpenAI model that has no price", () => {
    const result = config({ READER_RESOLUTION_MODEL: "gpt-unpriced" }, "resolution");

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "UNPRICED_MODEL" }) });
    expect(!result.success && result.error.message).toContain("resolution");
    expect(config({ READER_RESOLUTION_MODEL: "gpt-unpriced", READER_RESOLUTION_PROVIDER: "fake" }, "resolution").success).toBe(true);
  });

  test("refuses the fake provider in production", () => {
    const result = config({ READER_EXTRACTION_PROVIDER: "fake", NODE_ENV: "production" }, "extraction");

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "FAKE_IN_PRODUCTION" }) });
  });

  test("refuses an unknown provider and an invalid timeout", () => {
    expect(config({ READER_INTENT_PROVIDER: "anthropic" })).toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_STAGE_ENV" }) });
    expect(config({ READER_STAGE_TIMEOUT_MS: "soon" })).toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_STAGE_ENV" }) });
    expect(config({ READER_STAGE_TIMEOUT_MS: "0" }).success).toBe(false);
  });

  test("has no confirming configuration until a READER_<STAGE>_CONFIRM_ value is set", () => {
    expect(config({}, "extraction", "confirming")).toEqual({ success: true, data: null });
  });

  test("a confirming configuration takes its own model and inherits the rest from the primary", () => {
    const env = { READER_EXTRACTION_PROMPT: "extraction-v2", READER_EXTRACTION_CONFIRM_MODEL: "gpt-6-luna" };

    expect(config(env, "extraction", "confirming")).toEqual({ success: true, data: { stage: "extraction", reading: "confirming", provider: "openai", model: "gpt-6-luna", promptVersion: "extraction-v2", timeoutMs: 10_000 } });
    expect(config({ ...env, READER_EXTRACTION_CONFIRM_MODEL: "gpt-unpriced" }, "extraction", "confirming").success).toBe(false);
  });
});

describe("reading budget", () => {
  test("defaults to 60 s, reads READER_READING_BUDGET_MS and refuses a non-positive value", () => {
    expect(readReadingBudgetMs({})).toEqual({ success: true, data: 60_000 });
    expect(readReadingBudgetMs({ READER_READING_BUDGET_MS: "30000" })).toEqual({ success: true, data: 30_000 });
    expect(readReadingBudgetMs({ READER_READING_BUDGET_MS: "-1" })).toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_STAGE_ENV", message: expect.stringContaining("READER_READING_BUDGET_MS") }) });
    expect(readReadingBudgetMs({ READER_READING_BUDGET_MS: "soon" }).success).toBe(false);
  });
});
