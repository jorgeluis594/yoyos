import { describe, expect, test } from "vitest";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { createStage } from "@core/src/features/orders/infrastructure/reader/runtime/create-stage";
import { promptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { readStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";
import { contextMessage, readingInput } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent-test-support";

const config = (() => {
  const read = readStageConfig({ READER_INTENT_PROVIDER: "fake" }, "intent", "primary", promptRegistry);
  if (!read.success || !read.data) throw new Error("no intent config");
  return read.data;
})();

describe("intent stage with its registered version", () => {
  test("reads a scripted answer into an IntentReading and sends the instructions before the rendered input", async () => {
    const model = createFakeStructuredModel({ intent: [{ json: {
      outcome: "requests", noIntentReason: null, language: "pt",
      requests: [{ kind: "ready", quote: { message: "M1", text: "confirmo" } }], addresses: [{ message: "current", text: "Rua das Flores 12" }],
    } }] });
    const run = createStage(config, promptRegistry, { openai: null, fake: model })!;

    const result = await run(readingInput({ context: [contextMessage(1, { text: "confirmo" })] }), new AbortController().signal);

    expect(result).toMatchObject({ success: true, data: { value: { kind: "requests", language: "pt", requests: [{ id: "R1", kind: "ready" }], addresses: [{ message: "current", text: "Rua das Flores 12" }] },
      call: { stage: "intent", promptVersion: "intent-v1", attempts: 1 } } });
    expect(model.requests[0]).toMatchObject({ stage: "intent", schemaName: "intent_answer", instructions: promptRegistry.intent["intent-v1"]!.instructions });
    expect(model.requests[0]!.input).toContain("M1 (buyer, unmasked, text): confirmo");
  });

  test("retries once after an invalid answer and then fails as an invalid response", async () => {
    const bad = { json: { outcome: "requests", noIntentReason: null, language: "es", requests: [{ kind: "cancel_everything", quote: { message: "current", text: "x" } }], addresses: [] } };
    const model = createFakeStructuredModel({ intent: [bad, bad] });
    const run = createStage(config, promptRegistry, { openai: null, fake: model })!;

    const result = await run(readingInput(), new AbortController().signal);

    expect(result).toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE", stage: "intent" } });
    expect(model.requests).toHaveLength(2);
  });
});
