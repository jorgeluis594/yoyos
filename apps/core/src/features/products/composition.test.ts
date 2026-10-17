import { afterEach, describe, expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { createVisualSearch } from "@core/src/features/products/composition";

afterEach(() => { vi.restoreAllMocks(); });

describe("createVisualSearch", () => {
  test("builds the adapter of the configured provider and disables visual search without its key", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const setup = createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", IMAGE_EMBEDDER_PROVIDER: "openai", OPENAI_API_KEY: "key", PRODUCT_MATCH_MIN_CONFIDENCE: "" });
    const model = "openai/gpt-6-luna+text-embedding-3-small";
    expect(setup.embedder).toMatchObject({ model, embedImage: expect.any(Function) });
    expect(setup.visual).toMatchObject({ model, candidates: 5, minConfidence: 0.8, chooseProduct: expect.any(Function) });
    expect(info).not.toHaveBeenCalled();

    expect(createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", OPENAI_API_KEY: "" })).toEqual({ embedder: null, visual: null });
    expect(info).toHaveBeenLastCalledWith({ event: "product_visual_search_disabled", reason: "missing_api_key" }, "product_visual_search_disabled");
  });

  test("fails at startup for an unknown provider name", () => {
    expect(() => createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "acme", OPENAI_API_KEY: "key" })).toThrow();
    expect(() => createVisualSearch({ IMAGE_EMBEDDER_PROVIDER: "acme" })).toThrow();
  });
});
