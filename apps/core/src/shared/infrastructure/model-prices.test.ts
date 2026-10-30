import { describe, expect, test } from "vitest";
import { modelPrices, priceOf } from "@core/src/shared/infrastructure/model-prices";

describe("priceOf", () => {
  test("gives the reader model's price per million tokens", () => {
    expect(priceOf("gpt-6-luna")).toEqual({ input: 0.1, output: 0.5 });
  });

  test("gives the embedding model's price, with no output cost", () => {
    expect(priceOf("text-embedding-3-small")).toEqual({ input: 0.02, output: 0 });
  });

  test("gives null for a model with no price", () => {
    expect(priceOf("unknown")).toBeNull();
    expect(priceOf("")).toBeNull();
    expect(priceOf("constructor")).toBeNull();
    expect(priceOf("toString")).toBeNull();
  });

  test("lists only priced models", () => {
    expect(Object.keys(modelPrices).sort()).toEqual(["gpt-6-luna", "text-embedding-3-small"]);
  });
});
