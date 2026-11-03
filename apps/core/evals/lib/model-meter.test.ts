import { expect, test } from "vitest";
import { costOf } from "@core/evals/lib/model-meter";
import { modelPrices } from "@core/src/shared/infrastructure/model-prices";

test("prices the system's models from the shared price table and Claude from its own, and leaves an unknown model unpriced", () => {
  const million = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  for (const [model, price] of Object.entries(modelPrices)) expect(costOf({ model, ...million })).toBe(price.input + price.output);
  expect(costOf({ model: "claude-sonnet-5-5", ...million })).toBe(12);
  expect(costOf({ model: "unknown-model", ...million })).toBeNull();
});
