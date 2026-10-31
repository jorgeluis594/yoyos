import { describe, expect, test } from "vitest";
import { maxPhotoCandidates, photoStagesReserveUsd, visualStagesTokens } from "@core/src/features/products/infrastructure/product-matching/visual-stages-cost";

const openai = { provider: "openai", describeModel: "gpt-6-luna", embedModel: "text-embedding-3-small" } as const;

describe("photoStagesReserveUsd", () => {
  test("the photo stages at their bounds, with a detail image and the OpenAI describer, cost at most the reserve", () => {
    const reserve = photoStagesReserveUsd({ candidates: maxPhotoCandidates, matcherModel: "gpt-6-luna", embedder: openai });
    expect(reserve).toBeLessThanOrEqual(0.00142);
    expect(reserve).toBeGreaterThan(0.0014);
    const chooserInput = (2 + 8) * visualStagesTokens.imageInput + visualStagesTokens.chooserTextInput;
    expect(chooserInput).toBeGreaterThanOrEqual(10_769); // the measured billed tokens of 10 square 1,024-px images
    expect(visualStagesTokens.describerInput).toBeGreaterThanOrEqual(1_297);
  });

  test("the reserve with the local embedder leaves out the describer", () => {
    const local = photoStagesReserveUsd({ candidates: maxPhotoCandidates, matcherModel: "gpt-6-luna", embedder: { provider: "local" } });
    expect(local).toBeCloseTo(0.001127, 6);
    expect(local).toBeLessThan(photoStagesReserveUsd({ candidates: maxPhotoCandidates, matcherModel: "gpt-6-luna", embedder: openai }));
  });

  test("fewer candidates reserve less", () => {
    const reserve = (candidates: number) => photoStagesReserveUsd({ candidates, matcherModel: "gpt-6-luna", embedder: { provider: "local" } });
    expect(reserve(5)).toBeLessThan(reserve(8));
  });

  test("a matcher or describer model with no price throws", () => {
    expect(() => photoStagesReserveUsd({ candidates: 5, matcherModel: "unpriced-model", embedder: { provider: "local" } })).toThrow(/unpriced-model/);
    expect(() => photoStagesReserveUsd({ candidates: 5, matcherModel: "gpt-6-luna", embedder: { ...openai, describeModel: "unpriced-model" } })).toThrow(/unpriced-model/);
  });
});
