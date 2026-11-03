import { describe, expect, test } from "vitest";
import { createReaderStages } from "@core/src/features/orders/infrastructure/reader/runtime/create-stage";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import type { PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { testVersion } from "@core/src/features/orders/infrastructure/reader/runtime/runtime-test-support";
import type { StructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";
import type { ReadingInput } from "@core/src/features/orders/domain/reader/readings";

const registry = {
  intent: { "intent-v1": testVersion("intent", "intent-v1") },
  extraction: { "extraction-v1": testVersion("extraction", "extraction-v1") },
  resolution: { "resolution-v1": testVersion("resolution", "resolution-v1") },
} as unknown as PromptRegistry;
const signal = new AbortController().signal;
const spyClient = (): StructuredModel & { calls: string[] } => {
  const calls: string[] = [];
  return Object.assign(async (request: Parameters<StructuredModel>[0]) => { calls.push(request.stage); return { success: true as const, data: { json: { n: 1 }, usage: null } }; }, { calls });
};
const input = { current: { messageId: "m1", kind: "text", text: "hola" } } as unknown as ReadingInput;

describe("createReaderStages", () => {
  test("configuring one stage's provider changes only that stage's port", async () => {
    const openai = spyClient();
    const fake = createFakeStructuredModel({ extraction: [{ json: { n: 5 } }] });

    const stages = createReaderStages({ READER_EXTRACTION_PROVIDER: "fake" }, registry, { openai, fake });
    const extraction = await stages!.extractRequests(input, [], "primary", signal);
    const intent = await stages!.readIntent(input, "primary", signal);

    expect(extraction).toMatchObject({ success: true, data: { value: 5, call: { provider: "fake" } } });
    expect(fake.requests.map(({ stage }) => stage)).toEqual(["extraction"]);
    expect(intent).toMatchObject({ success: true, data: { call: { provider: "openai" } } });
    expect(openai.calls).toEqual(["intent"]);
  });

  test("reuses the primary port for a stage without a confirming configuration and reports which stages have one", async () => {
    const openai = spyClient();
    const stages = createReaderStages({ READER_EXTRACTION_CONFIRM_MODEL: "gpt-6-luna" }, registry, { openai, fake: null })!;

    expect(stages.confirms).toEqual({ intent: false, extraction: true, resolution: false });
    expect(await stages.readIntent(input, "confirming", signal)).toMatchObject({ success: true, data: { call: { reading: "primary" } } });
    expect(await stages.extractRequests(input, [], "confirming", signal)).toMatchObject({ success: true, data: { call: { reading: "confirming" } } });
  });

  test("refuses to start with an unknown prompt version, naming the stage and the version", () => {
    expect(() => createReaderStages({ READER_INTENT_PROMPT: "intent-v9" }, registry, { openai: spyClient(), fake: null })).toThrow(/intent.*intent-v9/);
  });

  test("is null without an OpenAI client and without a fake configuration", () => {
    expect(createReaderStages({}, registry, { openai: null, fake: null })).toBeNull();
    expect(createReaderStages({ READER_EXTRACTION_PROVIDER: "fake" }, registry, { openai: null, fake: createFakeStructuredModel({}) })).toBeNull();
  });
});
