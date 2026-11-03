import { ok } from "@shared/functional";
import type { StageVersion } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import type { ReaderStage } from "@core/src/features/orders/domain/reader/readings";

/** A stage version for runtime tests: the answer is valid when it is an object with a numeric `n`. */
export function testVersion(stage: ReaderStage, version: string): StageVersion<string, number> {
  return {
    stage, version, instructions: `${stage} instructions`, schemaName: `${stage}_answer`, jsonSchema: { type: "object" },
    reasoningEffort: "none", maxOutputTokens: 500,
    renderInput: (input) => `input:${input}`,
    parse: (answer) => typeof answer === "object" && answer !== null && typeof (answer as { n?: unknown }).n === "number"
      ? ok((answer as { n: number }).n) : { success: false, error: { message: "not a number" } },
  };
}
