import { describe, expect, test } from "vitest";
import { readAiEnv } from "@core/src/shared/ai-tools/infrastructure/ai-env";
import { createAiTools, createAiToolsFromEnv } from "@core/src/shared/ai-tools/composition";

describe("ai env and composition", () => {
  test("uses the documented defaults and treats empty values as unset", () => {
    expect(readAiEnv({ AI_TIMEOUT_MS: "", MESSAGE_ACTION_MIN_CONFIDENCE: "" })).toEqual({
      AI_EXTRACTION_MODEL: "gpt-6-luna", AI_TIMEOUT_MS: 20_000, MESSAGE_ACTION_MIN_CONFIDENCE: 0.6, MESSAGE_TOOL_PREDICATE_MIN: 0.5 });
  });

  test("fails on an invalid tuning value", () => {
    expect(() => readAiEnv({ MESSAGE_ACTION_MIN_CONFIDENCE: "1.5" })).toThrow();
  });

  test("disables the AI tools without an OpenAI client", () => {
    expect(createAiTools(null, readAiEnv({}))).toBeNull();
    expect(createAiToolsFromEnv({})).toBeNull();
  });

  test("builds the dependencies from the env thresholds when a key is configured", () => {
    const deps = createAiToolsFromEnv({ OPENAI_API_KEY: "key", MESSAGE_ACTION_MIN_CONFIDENCE: "0.7", MESSAGE_TOOL_PREDICATE_MIN: "0.4" });
    expect(deps).toMatchObject({ minActionConfidence: 0.7, minToolPredicate: 0.4 });
  });
});
