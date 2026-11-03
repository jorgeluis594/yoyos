import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { modelTextOf, pinnedModelTextPath, promptRegistry, registeredVersions } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { testVersion } from "@core/src/features/orders/infrastructure/reader/runtime/runtime-test-support";

const stagesDirectory = join(import.meta.dirname, "../stages");

describe("prompt registry", () => {
  test("registers each stage's versions under the stage's own key", () => {
    expect(Object.keys(promptRegistry).sort()).toEqual(["extraction", "intent", "resolution"]);
    for (const { stage, version, registered } of registeredVersions(promptRegistry)) expect(registered).toMatchObject({ stage, version });
  });

  test("keeps every stage's pinned model text in sync with its prompt version", () => {
    for (const { stage, version, registered } of registeredVersions(promptRegistry)) {
      const path = join(stagesDirectory, stage, pinnedModelTextPath(version));

      expect(existsSync(path), `${path} is missing`).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject(JSON.parse(JSON.stringify(modelTextOf(registered))));
    }
  });

  test("names the pinned model text file after the stage and the version", () => {
    expect(pinnedModelTextPath("intent-v1")).toBe("intent.v1.model-text.json");
    expect(modelTextOf(testVersion("intent", "intent-v1"))).toEqual({ instructions: "intent instructions", schemaName: "intent_answer", schema: { type: "object" }, reasoningEffort: "none", maxOutputTokens: 500 });
  });
});
